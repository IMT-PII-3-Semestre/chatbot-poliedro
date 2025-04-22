import os
import json
import logging
import re
from decimal import Decimal, InvalidOperation
from flask import Flask, request, jsonify, session, Response, stream_with_context
from flask_cors import CORS
from dotenv import load_dotenv

# Ajustar imports se a estrutura de diretórios mudar
from chatbot.handler import ChatbotHandler
from llm.integration import LLMIntegration

# --- Carregar Variáveis de Ambiente ---
load_dotenv()  # Carrega variáveis do arquivo .env na raiz do projeto

# --- Configuração do Logging ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# --- Configuração da Aplicação Flask ---
app = Flask(__name__)
# Use os.getenv para a chave secreta, com um padrão menos seguro para dev
app.secret_key = os.getenv("FLASK_SECRET_KEY", "chave-secreta-padrao-desenvolvimento")
# Configurar modo debug a partir de variável de ambiente
app.debug = os.getenv("FLASK_DEBUG", "False").lower() in ("true", "1", "t")
CORS(app, supports_credentials=True)

# --- Constantes e Configuração (Lidas do .env ou com padrões) ---
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434/api/generate")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "mistral")
OLLAMA_TIMEOUT = int(os.getenv("OLLAMA_TIMEOUT", 60))  # Converter para int
OLLAMA_TEMPERATURE = float(os.getenv("OLLAMA_TEMPERATURE", 0.5))  # Converter para float

MENU_FILE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'menu.json')

# Ler palavras de confirmação do .env, dividir por vírgula e criar um set
confirmation_words_str = os.getenv("CONFIRMATION_WORDS", "sim,correto,só isso,pode confirmar,confirmo,isso mesmo")
CONFIRMATION_WORDS = set(word.strip().lower() for word in confirmation_words_str.split(',') if word.strip())

# --- Constantes ---
MAX_HISTORY_MESSAGES = 6  # Manter 6 ultimas mensagens (3 user, 3 bot)

# --- Inicialização dos Componentes ---
try:
    # Passe as configurações lidas para LLMIntegration
    llm_integration = LLMIntegration(
        ollama_url=OLLAMA_URL,
        model_name=OLLAMA_MODEL,
        timeout=OLLAMA_TIMEOUT,
        temperature=OLLAMA_TEMPERATURE
    )
    chatbot_handler = ChatbotHandler(llm_integration=llm_integration)
    logging.info(f"Integração LLM inicializada com sucesso para o modelo '{OLLAMA_MODEL}'.")
except Exception as e:
    logging.exception("Erro fatal durante a inicialização dos componentes.")
    # Considerar sair da aplicação ou lidar com o erro de forma mais robusta
    llm_integration = None
    chatbot_handler = None

# --- Função Auxiliar: Carregar Cardápio ---
def load_menu_data():
    """Carrega os dados do cardápio do arquivo JSON.

    Returns:
        dict: Um dicionário mapeando nomes de itens (minúsculos) para preços (Decimal).
              Retorna um dicionário vazio se o arquivo não for encontrado ou houver erro.
    """
    menu_dict = {}
    if not os.path.exists(MENU_FILE_PATH):
        logging.error(f"Arquivo de cardápio não encontrado em: {MENU_FILE_PATH}")
        return {}

    try:
        with open(MENU_FILE_PATH, 'r', encoding='utf-8') as f:
            menu_list = json.load(f)
            if not isinstance(menu_list, list):
                 logging.error(f"Formato inválido no arquivo de cardápio: esperado uma lista, encontrado {type(menu_list)}.")
                 return {}

            for item in menu_list:
                if not isinstance(item, dict) or 'name' not in item or 'price' not in item:
                    logging.warning(f"Item de menu em formato inválido ignorado: {item}")
                    continue
                try:
                    name = str(item['name']).lower() # Garante que nome seja string e minúsculo
                    price = Decimal(str(item['price'])) # Garante que preço seja string antes de Decimal
                    if price < 0:
                         logging.warning(f"Item de menu com preço negativo ignorado: {item}")
                         continue
                    menu_dict[name] = price
                except (InvalidOperation, ValueError, TypeError) as item_error:
                    logging.warning(f"Erro ao processar item de menu {item}: {item_error}")
            logging.info(f"Cardápio carregado com {len(menu_dict)} itens válidos.")
            return menu_dict
    except json.JSONDecodeError:
        logging.exception(f"Erro ao decodificar JSON do cardápio em: {MENU_FILE_PATH}")
        return {}
    except Exception as e:
        logging.exception(f"Erro inesperado ao carregar dados do cardápio: {e}")
        return {}

# --- Endpoint Principal: Chat ---
@app.route('/chat', methods=['POST'])
def chat():
    """Processa a mensagem do usuário, interage com o LLM ou finaliza o pedido."""
    if not chatbot_handler:
         return jsonify({"error": "Chatbot não inicializado corretamente."}), 500

    data = request.get_json()
    if not data or 'message' not in data:
        logging.warning("Requisição para /chat sem 'message' no corpo JSON.")
        return jsonify({"error": "Mensagem não fornecida."}), 400

    user_input = data['message']
    if not isinstance(user_input, str) or not user_input.strip():
        logging.warning("Requisição para /chat com 'message' vazia ou inválida.")
        return jsonify({"error": "Mensagem não pode ser vazia."}), 400

    user_input = user_input.strip()
    logging.info(f"Mensagem recebida do usuário: '{user_input}'")

    # --- Gerenciamento do Histórico ---
    if 'chat_history' not in session:
        session['chat_history'] = []
    conversation_history = session['chat_history']
    # ---------------------------------

    # --- Processamento Normal (Streaming) ---
    # 1. Adiciona a mensagem do usuário ao histórico ANTES de chamar o LLM
    conversation_history.append({"sender": "user", "message": user_input})
    # Aplica limite (mantém o histórico atualizado para o LLM)
    session['chat_history'] = conversation_history[-MAX_HISTORY_MESSAGES:]
    session.modified = True

    # 2. Chama o handler (que retorna um gerador)
    # Passa a versão mais recente do histórico
    token_generator = chatbot_handler.process_input(user_input, session['chat_history'])

    # 3. Define uma função interna para gerar a resposta e atualizar o histórico completo
    def generate_stream():
        full_bot_response = []
        try:
            for token in token_generator:
                full_bot_response.append(token)
                yield token # Envia o token para o cliente
        finally:
            # 4. Atualiza o histórico com a resposta COMPLETA do bot APÓS o stream terminar
            if 'chat_history' in session: # Verifica se a sessão ainda existe
                final_response_str = "".join(full_bot_response)
                # Remove a mensagem do usuário que adicionamos temporariamente
                # e adiciona a resposta real do bot
                if session['chat_history'] and session['chat_history'][-1]['sender'] == 'user':
                     # Adiciona a resposta completa do bot
                     session['chat_history'].append({"sender": "bot", "message": final_response_str})
                     # Reaplica o limite se necessário (embora já deva estar ok)
                     session['chat_history'] = session['chat_history'][-MAX_HISTORY_MESSAGES:]
                     session.modified = True
                     logging.info("Histórico atualizado com resposta completa do bot após stream.")
                else:
                     logging.warning("Não foi possível atualizar o histórico do bot após stream - último item não era do usuário.")
            else:
                logging.warning("Sessão não encontrada para atualizar histórico do bot após stream.")

    # 5. Retorna a resposta em streaming
    # text/event-stream é comum para Server-Sent Events, mas text/plain funciona para streaming simples
    return Response(stream_with_context(generate_stream()), mimetype='text/plain')
    # -----------------------------------------

# --- Rota para Limpar Histórico ---
@app.route('/reset', methods=['POST'])
def reset_chat():
    if 'chat_history' in session:
        session.pop('chat_history', None)
        logging.info("Histórico da conversa resetado via /reset.")
    return jsonify({"status": "success", "message": "Histórico resetado."})
# ---------------------------------

# --- Endpoint: Gerenciar Cardápio ---
@app.route('/menu', methods=['GET', 'POST'])
def handle_menu():
    """Obtém ou atualiza o arquivo de cardápio."""
    if request.method == 'GET':
        try:
            menu_data = load_menu_data() # Usa a função auxiliar que já tem logging
            # Converte Decimal para string para serialização JSON
            menu_list_serializable = [{"id": f"item_{i}", "name": name.title(), "price": str(price)}
                                      for i, (name, price) in enumerate(menu_data.items())]
            return jsonify(menu_list_serializable)
        except Exception as e:
            # load_menu_data já loga erros específicos
            logging.exception("GET /menu: Erro inesperado ao preparar dados do menu para resposta.")
            return jsonify({"error": "Erro interno ao processar cardápio."}), 500

    elif request.method == 'POST':
        try:
            new_menu_data = request.json
            # Validação robusta do formato recebido
            if not isinstance(new_menu_data, list):
                 logging.warning(f"POST /menu: Recebido formato inválido. Esperado: lista. Recebido: {type(new_menu_data)}")
                 return jsonify({"error": "Formato de dados inválido. Esperado uma lista de itens."}), 400

            validated_menu = []
            for item in new_menu_data:
                if not isinstance(item, dict) or 'name' not in item or 'price' not in item:
                    logging.warning(f"POST /menu: Item inválido na lista recebida: {item}")
                    return jsonify({"error": f"Item inválido na lista: {item}. Cada item deve ser um dicionário com 'name' e 'price'."}), 400
                try:
                    name = str(item['name']).strip()
                    price_str = str(item['price']).replace(',', '.') # Aceita vírgula como decimal
                    price = Decimal(price_str)
                    if not name:
                         logging.warning(f"POST /menu: Item com nome vazio ignorado: {item}")
                         return jsonify({"error": f"Nome do item não pode ser vazio."}), 400
                    if price < 0:
                         logging.warning(f"POST /menu: Preço negativo inválido para o item: {item}")
                         return jsonify({"error": f"Preço inválido para o item '{name}': {item['price']}. Preço não pode ser negativo."}), 400
                    # Adiciona ID se não existir (ou mantém o existente)
                    item_id = item.get('id', f"item_{len(validated_menu)}_{os.urandom(4).hex()}")
                    validated_menu.append({"id": item_id, "name": name, "price": float(price)}) # Salva como float no JSON

                except (InvalidOperation, ValueError, TypeError):
                     logging.warning(f"POST /menu: Preço inválido para o item: {item}")
                     return jsonify({"error": f"Preço inválido para o item '{item.get('name')}': {item.get('price')}"}), 400

            # Salva o novo cardápio validado no arquivo
            with open(MENU_FILE_PATH, 'w', encoding='utf-8') as f:
                json.dump(validated_menu, f, indent=4, ensure_ascii=False)
            logging.info(f"POST /menu: Cardápio atualizado com sucesso em {MENU_FILE_PATH} com {len(validated_menu)} itens.")

            return jsonify({"message": "Cardápio atualizado com sucesso!"}), 200
        except Exception as e:
            logging.exception("POST /menu: Erro inesperado ao salvar o novo cardápio.")
            return jsonify({"error": "Erro interno ao salvar cardápio."}), 500

# --- Execução da Aplicação ---
if __name__ == '__main__':
    logging.info("Iniciando servidor Flask...")
    # O modo debug é controlado pela variável de ambiente agora
    app.run(host='0.0.0.0', port=5000)