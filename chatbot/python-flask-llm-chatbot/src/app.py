import os
import json
import logging
import re
from decimal import Decimal, InvalidOperation
from flask import Flask, request, jsonify, session # Import session
from flask_cors import CORS
from dotenv import load_dotenv

# Ajustar imports se a estrutura de diretórios mudar
from chatbot.handler import ChatbotHandler
from llm.integration import LLMIntegration

# --- Carregar Variáveis de Ambiente ---
load_dotenv() # Carrega variáveis do arquivo .env na raiz do projeto

# --- Configuração do Logging ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# --- Configuração da Aplicação Flask ---
app = Flask(__name__)
app.secret_key = os.getenv("FLASK_SECRET_KEY", "chave-secreta-padrao-desenvolvimento") # Secret key é essencial para sessions
app.debug = os.getenv("FLASK_DEBUG", "False").lower() in ("true", "1", "t")
CORS(app, supports_credentials=True) # supports_credentials=True é necessário para sessions com CORS

# --- Constantes e Configuração (Lidas do .env ou com padrões) ---
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434/api/generate")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "mistral")
OLLAMA_TIMEOUT = int(os.getenv("OLLAMA_TIMEOUT", 60))
OLLAMA_TEMPERATURE = float(os.getenv("OLLAMA_TEMPERATURE", 0.5))

MENU_FILE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'menu.json')

confirmation_words_str = os.getenv("CONFIRMATION_WORDS", "sim,correto,só isso,pode confirmar,confirmo,isso mesmo")
CONFIRMATION_WORDS = set(word.strip().lower() for word in confirmation_words_str.split(',') if word.strip())

# --- Inicialização dos Componentes ---
try:
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
                    name = str(item['name']).lower()
                    price = Decimal(str(item['price']))
                    if price < 0:
                         logging.warning(f"Item de menu com preço negativo ignorado: {item}")
                         continue
                    menu_dict[name] = price
                except (InvalidOperation, ValueError, TypeError) as item_error:
                    logging.warning(f"Erro ao processar item de menu {item}: {item_error}")
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
    if not request:
        return response
    description = get_request_description(request.method, request.path)
    app.logger.info(
        f'>>> Descrição: {description} (Status: {response.status_code})'
    )
    return response

# --- Função Auxiliar: Parsear itens da mensagem de confirmação do LLM ---
def parse_and_validate_items_from_confirmation(confirmation_message, menu):
    """
    Extrai itens da mensagem de confirmação do LLM ('Entendido. Você pediu: ... Correto?')
    e os valida contra o menu.

    Args:
        confirmation_message (str): A mensagem do LLM.
        menu (dict): O dicionário do cardápio carregado.

    Returns:
        list: Lista de dicionários {'name': str, 'quantity': int} dos itens válidos.
              Retorna lista vazia se não encontrar o padrão ou nenhum item for válido.
    """
    validated_items = []
    match = re.search(r'Entendido\.\s*Você\s+pediu:\s*(.*?)\s*Correto\?', confirmation_message, re.IGNORECASE | re.DOTALL)
    if not match:
        return [] # Padrão não encontrado

    items_string = match.group(1).strip()
    item_lines = [line.strip() for line in items_string.splitlines() if line.strip()]

    if not menu:
        logging.error("parse_and_validate: Cardápio vazio ou não carregado.")
        return []

    for line in item_lines:
        if line.startswith('- '):
            part = line[2:].strip()
        else:
            part = line

        if not part: continue

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
                validated_items.append({"name": name, "quantity": quantity}) # Adiciona item validado
            else:
                logging.warning(f"parse_and_validate: Item '{name}' da confirmação do LLM não encontrado no menu.")
        else:
            logging.warning(f"parse_and_validate: Não foi possível parsear linha da confirmação: '{line}'")

    return validated_items


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

    # Garante que o carrinho exista na sessão
    session.setdefault('cart', [])

    last_bot_message = session.get('last_bot_message', '')
    user_input_cleaned = user_input.lower().strip().rstrip('.,!')
    last_bot_asked_confirmation = last_bot_message.strip().endswith("Correto?")
    user_confirmed_intent = False

    if last_bot_asked_confirmation:
        try:
            confirmation_check_response = llm_integration.check_confirmation_intent(user_input, last_bot_message)
            if confirmation_check_response.strip().lower() == 'sim':
                user_confirmed_intent = True
        except Exception as intent_err:
            logging.error(f"Erro ao verificar intenção de confirmação com LLM: {intent_err}")
            user_confirmed_intent = False

    final_response_data = {"response": None, "final_order": None} # Adiciona campo para pedido finalizado

    # --- LÓGICA DE FINALIZAÇÃO PELO BACKEND (usando session['cart']) ---
    if user_confirmed_intent and last_bot_asked_confirmation:
        logging.info("Usuário confirmou pedido (intenção detectada via LLM). Tentando finalizar com carrinho da sessão.")
        current_cart = session.get('cart', [])

        if not current_cart:
            logging.warning("Finalização: Carrinho da sessão está vazio. Não há o que finalizar.")
            final_response_data["response"] = "Parece que não há itens no seu pedido para finalizar. O que gostaria de adicionar?"
            # Mantém o carrinho vazio
        else:
            try:
                total_price = Decimal('0.00')
                menu = load_menu_data()
                final_items_details = []
                calculation_errors = False

                if not menu:
                    logging.error("Finalização: Cardápio não pôde ser carregado para cálculo final.")
                    final_response_data["response"] = "Desculpe, não consigo calcular o total pois o cardápio está indisponível. Tente novamente mais tarde."
                    # Não limpa o carrinho aqui, pois o pedido não foi finalizado
                else:
                    for item_in_cart in current_cart:
                        name = item_in_cart.get("name")
                        quantity = item_in_cart.get("quantity", 1)
                        if not name: continue # Ignora item inválido no carrinho

                        name_lower = name.lower()
                        item_price = menu.get(name_lower)
                        # Tenta encontrar sem parênteses se não achar com
                        if item_price is None:
                            name_base = re.sub(r'\s*\(.*\)$', '', name).strip()
                            item_price = menu.get(name_base.lower())

                        if item_price is not None:
                            final_items_details.append({"name": name, "quantity": quantity})
                            total_price += item_price * quantity
                        else:
                            logging.error(f"Finalização: Item '{name}' do carrinho não encontrado no menu durante cálculo final!")
                            calculation_errors = True
                            # Poderia adicionar uma mensagem de erro específica aqui

                    if calculation_errors:
                         final_response_data["response"] = "Desculpe, houve um erro ao calcular o total. Alguns itens do seu pedido podem não estar mais disponíveis. Por favor, verifique e tente novamente."
                         # Não limpa o carrinho
                    elif not final_items_details:
                         final_response_data["response"] = "Seu carrinho está vazio. Não foi possível finalizar."
                         # Limpa o carrinho (já estava vazio)
                         session['cart'] = []
                    else:
                        items_final_string = ", ".join([f"{item['quantity']}x {item['name']}" for item in final_items_details])
                        total_str = f"{total_price:.2f}".replace('.', ',')
                        final_response_data["response"] = f"Ótimo! Pedido anotado: {items_final_string}. Total: R$ {total_str}. Seu pedido foi enviado para a cozinha!"
                        # Adiciona os dados estruturados para o frontend/KDS
                        final_response_data["final_order"] = {"items": final_items_details, "total": float(total_price)}
                        logging.info(f"Pedido finalizado pelo backend com carrinho da sessão: {final_response_data['response']}")
                        # Limpa o carrinho APÓS finalizar com sucesso
                        session['cart'] = []

            except Exception as e:
                logging.exception("Erro GERAL durante a finalização pelo backend usando carrinho da sessão.")
                final_response_data["response"] = "Desculpe, ocorreu um erro interno ao tentar finalizar seu pedido."
                # Considerar se deve limpar o carrinho ou não em caso de erro geral

    # --- Se não for finalização pelo backend (ou se a finalização falhou) ---
    if final_response_data["response"] is None:
        try:
            # Chama o LLM para obter a resposta normal
            llm_response = chatbot_handler.process_input(user_input)
            final_response_data["response"] = llm_response

            # --- LÓGICA PARA ATUALIZAR O CARRINHO DA SESSÃO ---
            # Verifica se a resposta do LLM é uma confirmação para atualizar o carrinho
            if llm_response.strip().endswith("Correto?"):
                 menu = load_menu_data()
                 validated_items_from_llm = parse_and_validate_items_from_confirmation(llm_response, menu)
                 if validated_items_from_llm:
                     logging.info(f"Atualizando carrinho da sessão com itens validados da confirmação LLM: {validated_items_from_llm}")
                     session['cart'] = validated_items_from_llm # Substitui o carrinho com os itens confirmados
                 else:
                     logging.warning("LLM pediu confirmação, mas não foi possível validar itens para atualizar o carrinho.")
                     # Opcional: Poderia limpar o carrinho aqui se a validação falhar? Ou manter o antigo?
                     # Manter o antigo parece mais seguro por enquanto. session['cart'] = [] # Descomentar para limpar

        except Exception as e:
            logging.exception("Erro ao chamar chatbot_handler.process_input ou ao atualizar carrinho.")
            final_response_data["response"] = "Desculpe, ocorreu um erro interno ao processar sua mensagem. Tente novamente mais tarde."

    # Armazena a resposta final (do LLM ou da finalização) na sessão
    session['last_bot_message'] = final_response_data["response"]

    # Retorna a resposta final para o frontend (incluindo 'final_order' se houver)
    return jsonify(final_response_data)


# --- Endpoint: Gerenciar Cardápio ---
@app.route('/menu', methods=['GET', 'POST'])
def handle_menu():
    """Obtém ou atualiza o arquivo de cardápio."""
    if request.method == 'GET':
        try:
            menu_data = load_menu_data()
            menu_list_serializable = [{"id": f"item_{i}", "name": name.title(), "price": str(price)}
                                      for i, (name, price) in enumerate(menu_data.items())]
            return jsonify(menu_list_serializable)
        except Exception as e:
            logging.exception("GET /menu: Erro inesperado ao preparar dados do menu para resposta.")
            return jsonify({"error": "Erro interno ao processar cardápio."}), 500

    elif request.method == 'POST':
        # ... (código do POST /menu permanece o mesmo) ...
        try:
            new_menu_data = request.json
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
                    price_str = str(item['price']).replace(',', '.')
                    price = Decimal(price_str)
                    if not name:
                         logging.warning(f"POST /menu: Item com nome vazio ignorado: {item}")
                         return jsonify({"error": f"Nome do item não pode ser vazio."}), 400
                    if price < 0:
                         logging.warning(f"POST /menu: Preço negativo inválido para o item: {item}")
                         return jsonify({"error": f"Preço inválido para o item '{name}': {item['price']}. Preço não pode ser negativo."}), 400
                    item_id = item.get('id', f"item_{len(validated_menu)}_{os.urandom(4).hex()}")
                    validated_menu.append({"id": item_id, "name": name, "price": float(price)})

                except (InvalidOperation, ValueError, TypeError):
                     logging.warning(f"POST /menu: Preço inválido para o item: {item}")
                     return jsonify({"error": f"Preço inválido para o item '{item.get('name')}': {item.get('price')}"}), 400

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
    app.run(host='0.0.0.0', port=5000)