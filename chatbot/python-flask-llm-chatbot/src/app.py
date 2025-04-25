import os
import json
import logging
import re
from decimal import Decimal, InvalidOperation
from flask import Flask, request, jsonify, session
from flask_cors import CORS
from dotenv import load_dotenv

# Ajustar imports se a estrutura de diretórios mudar
from chatbot.handler import ChatbotHandler
from llm.integration import LLMIntegration

# --- Carregar Variáveis de Ambiente ---
load_dotenv() # Carrega variáveis do arquivo .env na raiz do projeto

# --- Configuração do Logging ---
# Mantido INFO para logs importantes, mas debug logs serão removidos ou comentados
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# --- Configuração da Aplicação Flask ---
app = Flask(__name__)
app.secret_key = os.getenv("FLASK_SECRET_KEY", "chave-secreta-padrao-desenvolvimento")
# Configurar modo debug a partir de variável de ambiente
app.debug = os.getenv("FLASK_DEBUG", "False").lower() in ("true", "1", "t")
CORS(app, supports_credentials=True)

# --- Constantes e Configuração (Lidas do .env ou com padrões) ---
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434/api/generate")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "mistral")
OLLAMA_TIMEOUT = int(os.getenv("OLLAMA_TIMEOUT", 60))
OLLAMA_TEMPERATURE = float(os.getenv("OLLAMA_TEMPERATURE", 0.5))

MENU_FILE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'menu.json')

# Ler palavras de confirmação do .env, dividir por vírgula e criar um set
confirmation_words_str = os.getenv("CONFIRMATION_WORDS", "sim,correto,só isso,pode confirmar,confirmo,isso mesmo")
CONFIRMATION_WORDS = set(word.strip().lower() for word in confirmation_words_str.split(',') if word.strip())

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
            # logging.info(f"Cardápio carregado com {len(menu_dict)} itens válidos.") # Log menos essencial removido
            return menu_dict
    except json.JSONDecodeError:
        logging.exception(f"Erro ao decodificar JSON do cardápio em: {MENU_FILE_PATH}")
        return {}
    except Exception as e:
        logging.exception(f"Erro inesperado ao carregar dados do cardápio: {e}")
        return {}

# --- Função Auxiliar para Descrição do Log ---
def get_request_description(method, path):
    """Retorna uma descrição em português para a requisição."""
    if method == 'GET' and path == '/menu':
        return "Requisição para obter o cardápio"
    elif method == 'POST' and path == '/menu':
        return "Requisição para atualizar o cardápio"
    elif method == 'OPTIONS' and path == '/chat':
        return "Requisição OPTIONS (preflight) para o chat"
    elif method == 'POST' and path == '/chat':
        return "Requisição para enviar mensagem ao chat"
    else:
        return f"Requisição {method} para {path}"

# --- Decorador para Logar Após Cada Requisição ---
@app.after_request
def log_request_info(response):
    """Loga detalhes da requisição com descrição em português após cada requisição."""
    # Não loga se a requisição falhou antes de chegar aqui (raro)
    if not request:
        return response

    description = get_request_description(request.method, request.path)
    # Usa app.logger para adicionar a linha de log personalizada
    app.logger.info(
        f'>>> Descrição: {description} (Status: {response.status_code})'
    )
    # Retorna a resposta original para não interferir no fluxo
    return response

# --- Endpoint Principal: Chat ---
@app.route('/chat', methods=['POST'])
def chat():
    """Processa a mensagem do usuário, interage com o LLM ou finaliza o pedido."""
    if not chatbot_handler:
         return jsonify({"error": "Chatbot não inicializado corretamente."}), 500

    data = request.json
    if not data or 'message' not in data:
        logging.warning("Requisição para /chat sem 'message' no corpo JSON.")
        return jsonify({"error": "JSON inválido ou chave 'message' ausente."}), 400

    user_input = data['message']
    if not isinstance(user_input, str) or not user_input.strip():
        logging.warning("Requisição para /chat com 'message' vazia ou inválida.")
        return jsonify({"error": "Mensagem não pode ser vazia."}), 400

    user_input = user_input.strip()

    # Recupera a última mensagem do bot da sessão
    last_bot_message = session.get('last_bot_message', '')
    # logging.info(f"Sessão - Última mensagem do bot recuperada: '{last_bot_message}'") # Log de debug removido

    user_input_cleaned = user_input.lower().strip().rstrip('.,!')
    is_user_confirming = user_input_cleaned in CONFIRMATION_WORDS
    last_bot_asked_confirmation = last_bot_message.strip().endswith("Correto?")

    # logging.info(f"Input usuário: '{user_input}', Limpo: '{user_input_cleaned}', Confirmando: {is_user_confirming}") # Log de debug removido
    # logging.info(f"Sessão - Última msg bot terminou com 'Correto?': {last_bot_asked_confirmation}") # Log de debug removido

    final_response_data = {"response": None}

    # --- LÓGICA DE FINALIZAÇÃO PELO BACKEND ---
    if is_user_confirming and last_bot_asked_confirmation:
        logging.info("Usuário confirmou pedido. Iniciando finalização pelo backend.")
        try:
            # Regex ajustado para capturar a lista entre "Você pediu:" e "Correto?"
            match = re.search(r'Entendido\.\s*Você\s+pediu:\s*(.*?)\s*Correto\?', last_bot_message, re.IGNORECASE | re.DOTALL)
            if match:
                items_string = match.group(1).strip()
                # Divide a string capturada em linhas e remove linhas vazias
                item_lines = [line.strip() for line in items_string.splitlines() if line.strip()]

                parsed_items_details = []
                total_price = Decimal('0.00')
                menu = load_menu_data()
                parse_errors = [] # Lista para guardar nomes de itens NÃO encontrados no menu

                if not menu:
                    logging.error("Finalização: Cardápio não pôde ser carregado para validação.")
                    final_response_data["response"] = "Desculpe, não consigo verificar seu pedido pois o cardápio está indisponível no momento. Tente novamente mais tarde."
                else:
                    # Itera sobre cada linha da lista de itens
                    for line in item_lines:
                        # Remove o prefixo '- ' se existir
                        if line.startswith('- '):
                            part = line[2:].strip()
                        else:
                            part = line # Se não começar com '- ', tenta parsear a linha inteira

                        if not part: continue

                        # Usa o regex existente para extrair quantidade e nome
                        item_match = re.match(r'^(?:(\d+)\s*x\s+)?(.+)$', part, re.IGNORECASE)
                        if item_match:
                            quantity = int(item_match.group(1) or 1)
                            name = item_match.group(2).strip()
                            name_lower = name.lower()
                            item_price = menu.get(name_lower)

                            # Tenta encontrar sem parênteses se não achar com
                            if item_price is None:
                                name_base = re.sub(r'\s*\(.*\)$', '', name).strip()
                                item_price = menu.get(name_base.lower())

                            if item_price is not None:
                                parsed_items_details.append({"name": name, "quantity": quantity})
                                total_price += item_price * quantity
                            else:
                                logging.warning(f"Finalização: Item inválido confirmado pelo usuário: '{name}' (não encontrado no menu)")
                                parse_errors.append(name)
                        else:
                            logging.warning(f"Finalização: Não foi possível parsear estrutura do item confirmado na linha: '{line}'")
                            parse_errors.append(line) # Adiciona a linha inteira como erro

                    # --- VERIFICAÇÃO DE ERROS ANTES DE FINALIZAR ---
                    if parse_errors:
                        invalid_items_str = ", ".join(parse_errors)
                        logging.error(f"Finalização BLOQUEADA. Itens inválidos detectados: {invalid_items_str}")
                        final_response_data["response"] = f"Desculpe, não posso finalizar o pedido. Os seguintes itens não estão no cardápio ou não foram reconhecidos: {invalid_items_str}. Por favor, peça novamente apenas com itens válidos."
                    elif not parsed_items_details:
                         logging.error(f"Finalização BLOQUEADA. Nenhum item válido foi extraído da confirmação: '{items_string}'")
                         final_response_data["response"] = "Desculpe, não consegui entender os itens do seu pedido para finalizar. Poderia tentar novamente?"
                    else:
                        items_final_string = ", ".join([f"{item['quantity']}x {item['name']}" for item in parsed_items_details])
                        total_str = f"{total_price:.2f}".replace('.', ',')
                        final_response_data["response"] = f"Ótimo! Pedido anotado: {items_final_string}. Total: R$ {total_str}. Seu pedido foi enviado para a cozinha!"
                        logging.info(f"Pedido finalizado pelo backend: {final_response_data['response']}")
                        # Ex: save_order_to_kds(parsed_items_details, total_price) # Exemplo de chamada futura

            else:
                # Mensagem de log mais específica
                logging.warning(f"Finalização: Regex não encontrou o padrão de confirmação esperado na mensagem do bot: '{last_bot_message}'")
                # Resposta para o usuário caso o regex falhe em extrair
                final_response_data["response"] = "Entendido. Seu pedido foi registrado. (Não foi possível extrair detalhes via regex)"

        except Exception as e:
            logging.exception("Erro GERAL durante a finalização pelo backend.")
            final_response_data["response"] = "Desculpe, ocorreu um erro interno ao tentar finalizar seu pedido."

    # --- Se não for finalização pelo backend (ou se a finalização falhou e gerou uma resposta de erro) ---
    if final_response_data["response"] is None:
        # logging.info("Condição de finalização backend não atendida ou falhou. Chamando LLM.") # Log de debug removido
        try:
            # Processa a entrada do usuário usando o handler do chatbot (que chama o LLM)
            llm_response = chatbot_handler.process_input(user_input)
            final_response_data["response"] = llm_response
            # logging.info(f"Resposta recebida do LLM: '{final_response_data['response']}") # Log de debug removido
        except Exception as e:
            logging.exception("Erro ao chamar chatbot_handler.process_input.")
            # Define uma resposta de erro padrão para o usuário
            final_response_data["response"] = "Desculpe, ocorreu um erro interno ao processar sua mensagem. Tente novamente mais tarde."
            # Não retorna 500 aqui para permitir que a resposta de erro seja salva na sessão e enviada
    # else:
         # logging.info("Resposta final definida pelo backend, pulando chamada ao LLM.") # Log de debug removido

    # Armazena a resposta final na sessão para a próxima requisição
    session['last_bot_message'] = final_response_data["response"]
    # logging.info(f"Sessão - Armazenando resposta final: '{final_response_data['response']}") # Log de debug removido

    # Retorna a resposta final para o frontend
    return jsonify(final_response_data)

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