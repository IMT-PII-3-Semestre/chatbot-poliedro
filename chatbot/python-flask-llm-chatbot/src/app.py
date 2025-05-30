import os
import json
import logging
from decimal import Decimal, InvalidOperation
from flask import Flask, request, jsonify, session
from flask_cors import CORS
from dotenv import load_dotenv
from pymongo import MongoClient
from pymongo.errors import ConnectionFailure, OperationFailure # Ensure OperationFailure is imported
from bson.objectid import ObjectId # Import ObjectId
import datetime
import pytz
from chatbot.handler import ChatbotHandler
from llm.integration import LLMIntegration

# --- Carregar Variáveis de Ambiente ---
load_dotenv()

# --- Configuração do Logging ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# --- Configuração da Aplicação Flask ---
app = Flask(__name__)
app.secret_key = os.getenv("FLASK_SECRET_KEY", "chave-secreta-padrao-desenvolvimento")
app.debug = os.getenv("FLASK_DEBUG", "False").lower() in ("true", "1", "t")
CORS(app, supports_credentials=True)

# --- Constantes e Configuração ---
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434/api/generate")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "mistral")
OLLAMA_TIMEOUT = int(os.getenv("OLLAMA_TIMEOUT", 60))
OLLAMA_TEMPERATURE = float(os.getenv("OLLAMA_TEMPERATURE", 0.5))
MENU_FILE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'menu.json')
MONGODB_URI = os.getenv("MONGODB_URI")

# --- Inicialização dos Componentes ---
llm_integration = None
chatbot_handler = None
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

# --- Configuração do MongoDB ---
mongo_client = None
db = None
orders_collection = None
if MONGODB_URI:
    try:
        mongo_client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=5000)
        # Test the connection
        mongo_client.admin.command('ping')
        db = mongo_client.get_database("poliedro_chatbot_db") # Ou o nome do seu banco de dados
        orders_collection = db.get_collection("orders")
        logging.info("Conexão com MongoDB estabelecida com sucesso.")
    except ConnectionFailure:
        logging.error("Falha ao conectar ao MongoDB: Verifique a URI de conexão e a disponibilidade do servidor.")
        mongo_client = None # Garante que não tentaremos usar um cliente inválido
    except Exception as e:
        logging.exception(f"Erro inesperado ao configurar MongoDB: {e}")
        mongo_client = None
else:
    logging.warning("MONGODB_URI não configurada. A integração com MongoDB está desabilitada.")

# --- Função Auxiliar: Carregar Cardápio ---
def load_menu_data():
    """
    Carrega os dados do cardápio do arquivo JSON.

    Returns:
        dict: Mapeando nomes de itens (minúsculos) para um dict 
              contendo {"original_name": str, "price": Decimal}.
              Retorna um dicionário vazio se houver erro.
    """
    menu_data_for_handler = {}
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
                    original_name = str(item['name'])
                    price = Decimal(str(item['price']))
                    if price < 0:
                         logging.warning(f"Item de menu com preço negativo ignorado: {item}")
                         continue
                    menu_data_for_handler[original_name.lower()] = {"original_name": original_name, "price": price}
                except (InvalidOperation, ValueError, TypeError) as item_error:
                    logging.warning(f"Erro ao processar item de menu {item}: {item_error}")
            return menu_data_for_handler
    except json.JSONDecodeError:
        logging.exception(f"Erro ao decodificar JSON do cardápio em: {MENU_FILE_PATH}")
        return {}
    except Exception as e:
        logging.exception(f"Erro inesperado ao carregar dados do cardápio: {e}")
        return {}

# --- Função Auxiliar para Descrição do Log ---
def get_request_description(method, path):
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
    if not request:
        return response
    description = get_request_description(request.method, request.path)
    app.logger.info(
        f'>>> Descrição: {description} (Status: {response.status_code})'
    )
    return response

# --- Endpoint Principal: Chat ---
@app.route('/chat', methods=['POST'])
def chat():
    data = request.get_json()
    user_input = data.get('message', '').strip()

    if not chatbot_handler or not llm_integration:
        logging.error("/chat: Componentes não inicializados.")
        return jsonify({"response": "Desculpe, o serviço de chat está temporariamente indisponível.", "cart": []}), 503

    if not user_input:
        return jsonify({"response": "Por favor, digite uma mensagem.", "cart": session.get('cart', [])}), 400

    if 'cart' not in session:
        session['cart'] = []
    if 'conversation_history' not in session:
        session['conversation_history'] = []
    if 'last_bot_message' not in session:
        session['last_bot_message'] = ""

    final_response_data = {"response": None, "cart": list(session.get('cart', []))}
    current_menu_data = load_menu_data() 

    last_bot_message_for_confirmation = session.get('last_bot_message', '').strip()
    is_direct_confirmation_response = user_input.lower() in ["sim", "não"] and \
                                      last_bot_message_for_confirmation.endswith("Correto?")

    brasilia_tz = pytz.timezone('America/Sao_Paulo') # Define Brasilia timezone

    if is_direct_confirmation_response:
        confirmation_intent_result = user_input.lower()
        logging.info(f"Confirmação direta recebida do frontend: '{confirmation_intent_result}'")
        
        if confirmation_intent_result == "sim":
            if not session.get('cart'):
                final_response_data["response"] = "Seu carrinho está vazio. Adicione itens antes de finalizar."
            else:
                order_details_text, total_calculated = chatbot_handler.format_order_details(
                    session['cart'], current_menu_data, include_total=True, for_confirmation=False
                )
                final_response_data["response"] = "Ótimo! Seu pedido foi anotado e enviado para a cozinha!"
                final_order_payload = {
                    "items": list(session['cart']),
                    "total": str(total_calculated),
                    "order_details_text": order_details_text,
                    "timestamp": datetime.datetime.now(brasilia_tz), # Use Brasilia timezone
                    "status": "Pendente"
                }
                # final_response_data['final_order'] is assigned final_order_payload.
                # If final_order_payload is mutated by insert_one, final_response_data['final_order'] will reflect that.
                final_response_data['final_order'] = final_order_payload 
    
                if orders_collection is not None:
                    try:
                        # PyMongo's insert_one mutates final_order_payload by adding _id
                        insert_result = orders_collection.insert_one(final_order_payload)
                        logging.info(f"Pedido finalizado e salvo no MongoDB com ID: {insert_result.inserted_id}")
                        # Convert ObjectId to string for JSON serialization
                        if '_id' in final_order_payload:
                            final_order_payload['_id'] = str(final_order_payload['_id'])
                    except OperationFailure as e:
                        logging.error(f"Falha ao salvar pedido no MongoDB: {e.details}")
                    except Exception as e:
                        logging.exception("Erro inesperado ao salvar pedido no MongoDB.")
                else:
                    logging.warning("MongoDB não configurado. Pedido não foi salvo no banco de dados.")
    
                logging.info(f"Pedido finalizado via botão 'Sim': {session['cart']}")
                session['cart'] = []
                session['conversation_history'] = [] 
                session['last_bot_message'] = ""
        else: 
            final_response_data["response"] = "Entendido. O que você gostaria de alterar ou adicionar?"
        
    else: 
        try:
            processed_output = chatbot_handler.process_input(
                user_input,
                list(session.get('cart', [])),
                list(session.get('conversation_history', [])),
                session.get('last_bot_message', ''),
                current_menu_data 
            )

            final_response_data["response"] = processed_output.get("llm_response")
            action = processed_output.get("action")
            
            session['cart'] = processed_output.get("cart_updated", list(session.get('cart', [])))

            if action == "needs_confirmation":
                logging.info(f"Handler indica necessidade de confirmação. Carrinho para confirmar: {session['cart']}")

            elif action == "finalize_order_confirmed":
                if not session.get('cart'): 
                    final_response_data["response"] = "Seu carrinho está vazio. Adicione itens antes de finalizar."
                else:
                    order_details_text, total_calculated = chatbot_handler.format_order_details(
                        session['cart'], current_menu_data, include_total=True, for_confirmation=False
                    )
                    final_order_payload = {
                        "items": list(session['cart']),
                        "total": str(total_calculated),
                        "order_details_text": order_details_text,
                        "timestamp": datetime.datetime.now(brasilia_tz), # Use Brasilia timezone
                        "status": "Pendente"
                    }
                    final_response_data['final_order'] = final_order_payload
    
                    if orders_collection is not None:
                        try:
                            # PyMongo's insert_one mutates final_order_payload by adding _id
                            insert_result = orders_collection.insert_one(final_order_payload)
                            logging.info(f"Pedido (confirmado pelo LLM) salvo no MongoDB com ID: {insert_result.inserted_id}")
                            # Convert ObjectId to string for JSON serialization
                            if '_id' in final_order_payload:
                                final_order_payload['_id'] = str(final_order_payload['_id'])
                        except OperationFailure as e:
                            logging.error(f"Falha ao salvar pedido (confirmado pelo LLM) no MongoDB: {e.details}")
                        except Exception as e:
                            logging.exception("Erro inesperado ao salvar pedido (confirmado pelo LLM) no MongoDB.")
                    else:
                        logging.warning("MongoDB não configurado. Pedido (confirmado pelo LLM) não foi salvo no banco de dados.")
    
                    logging.info(f"Pedido finalizado (confirmado pelo LLM via handler): {session['cart']}")
                    session['cart'] = []
                    session['conversation_history'] = []
                    session['last_bot_message'] = ""

            elif action == "clear_cart":
                logging.info("Carrinho limpo conforme instrução do handler.")

        except Exception as e:
            logging.exception("Erro ao chamar chatbot_handler.process_input ou ao processar sua saída.")
            final_response_data["response"] = "Desculpe, ocorreu um erro interno ao processar sua mensagem. Tente novamente mais tarde."

    final_response_data["cart"] = list(session.get('cart', []))
    session['last_bot_message'] = final_response_data.get("response")

    if user_input:
        session['conversation_history'].append({"role": "user", "content": user_input})
    if final_response_data.get("response"):
        session['conversation_history'].append({"role": "assistant", "content": final_response_data["response"]})
    
    MAX_HISTORY_LEN = 10 
    if len(session.get('conversation_history', [])) > MAX_HISTORY_LEN:
        session['conversation_history'] = session['conversation_history'][-MAX_HISTORY_LEN:]

    session.modified = True
    return jsonify(final_response_data)

# --- Endpoint: Gerenciar Cardápio ---
@app.route('/menu', methods=['GET', 'POST'])
def handle_menu():
    if request.method == 'GET':
        try:
            menu_data = load_menu_data()
            menu_list_serializable = [
                {"id": f"item_{i}", "name": data["original_name"].title(), "price": str(data["price"])}
                for i, (key, data) in enumerate(menu_data.items())
            ]
            return jsonify(menu_list_serializable)
        except Exception as e:
            logging.exception("GET /menu: Erro inesperado ao preparar dados do menu para resposta.")
            return jsonify({"error": "Erro interno ao processar cardápio."}), 500

    elif request.method == 'POST':
        try:
            new_menu_data_from_request = request.json
            if not isinstance(new_menu_data_from_request, list):
                 logging.warning(f"POST /menu: Recebido formato inválido. Esperado: lista. Recebido: {type(new_menu_data_from_request)}")
                 return jsonify({"error": "Formato de dados inválido. Esperado uma lista de itens."}), 400

            validated_menu_to_save = []
            for item_from_request in new_menu_data_from_request:
                if not isinstance(item_from_request, dict) or 'name' not in item_from_request or 'price' not in item_from_request:
                    logging.warning(f"POST /menu: Item inválido na lista recebida: {item_from_request}")
                    return jsonify({"error": f"Item inválido na lista: {item_from_request}. Cada item deve ser um dicionário com 'name' e 'price'."}), 400
                try:
                    name = str(item_from_request['name']).strip()
                    price_str = str(item_from_request['price']).replace(',', '.')
                    price = Decimal(price_str)
                    if not name:
                         logging.warning(f"POST /menu: Item com nome vazio ignorado: {item_from_request}")
                         return jsonify({"error": f"Nome do item não pode ser vazio."}), 400
                    if price < 0:
                         logging.warning(f"POST /menu: Preço negativo inválido para o item: {item_from_request}")
                         return jsonify({"error": f"Preço inválido para o item '{name}': {item_from_request['price']}. Preço não pode ser negativo."}), 400
                    
                    validated_menu_to_save.append({"name": name, "price": float(price)})

                except (InvalidOperation, ValueError, TypeError):
                     logging.warning(f"POST /menu: Preço inválido para o item: {item_from_request}")
                     return jsonify({"error": f"Preço inválido para o item '{item_from_request.get('name')}': {item_from_request.get('price')}"}), 400

            with open(MENU_FILE_PATH, 'w', encoding='utf-8') as f:
                json.dump(validated_menu_to_save, f, indent=4, ensure_ascii=False)
            logging.info(f"POST /menu: Cardápio atualizado com sucesso em {MENU_FILE_PATH} com {len(validated_menu_to_save)} itens.")
            
            return jsonify({"message": "Cardápio atualizado com sucesso!"}), 200
        except Exception as e:
            logging.exception("POST /menu: Erro inesperado ao salvar o novo cardápio.")
            return jsonify({"error": "Erro interno ao salvar cardápio."}), 500

# --- API Endpoint: KDS Orders ---
@app.route('/api/kds/orders', methods=['GET'])
def api_kds_orders():
    requested_status = request.args.get('status', 'Pendente') # Default to 'Pendente'
    
    valid_statuses_for_fetch = ['Pendente', 'Em Preparo', 'Pronto'] # Define quais status podem ser buscados
    if requested_status not in valid_statuses_for_fetch:
        logging.warning(f"/api/kds/orders: Status de busca inválido '{requested_status}'.")
        return jsonify({"error": f"Status de busca inválido. Permitidos: {', '.join(valid_statuses_for_fetch)}"}), 400

    logging.info(f"/api/kds/orders: Iniciando busca de pedidos com status '{requested_status}'. orders_collection is {'None' if orders_collection is None else 'válida'}.")
    if orders_collection is not None:
        try:
            logging.info(f"/api/kds/orders: Tentando buscar e ordenar pedidos com status '{requested_status}' do MongoDB.")
            # Busca pedidos com o status solicitado
            # Ordenados pelo mais antigo primeiro (FIFO para a cozinha) ou mais recente para finalizados
            sort_order = 1 if requested_status in ['Pendente', 'Em Preparo'] else -1 # Mais recentes primeiro para 'Pronto'
            
            kds_orders_cursor = orders_collection.find({"status": requested_status}).sort("timestamp", sort_order)
            kds_orders = list(kds_orders_cursor) # Execute query and convert to list
            logging.info(f"/api/kds/orders: Encontrados {len(kds_orders)} pedidos com status '{requested_status}'.")
            
            processed_orders = []
            for order_data in kds_orders: # Use a new variable to avoid modifying the iterator
                # Convert ObjectId to string
                order_data['_id'] = str(order_data['_id'])
                
                # Format the timestamp for display and ensure the original datetime object is handled
                timestamp_obj = order_data.get('timestamp')
                if isinstance(timestamp_obj, datetime.datetime):
                    # The timestamp_obj from MongoDB is a naive datetime representing UTC.
                    # Make it UTC-aware before converting to ISO string so JS parses it correctly as UTC.
                    aware_utc_timestamp = timestamp_obj.replace(tzinfo=datetime.timezone.utc)
                    order_data['timestamp_iso'] = aware_utc_timestamp.isoformat()
                else:
                    # If timestamp is not a datetime object (e.g., already a string or None)
                    # or if it's missing, set timestamp_iso appropriately.
                    if timestamp_obj is not None:
                        logging.warning(f"/api/kds/orders: Timestamp para pedido {order_data['_id']} não é um objeto datetime, é {type(timestamp_obj)}.")
                        order_data['timestamp_iso'] = str(timestamp_obj) # Fallback to string conversion
                    else:
                        order_data['timestamp_iso'] = None 
                
                # Remove the original datetime object from the dictionary before jsonify
                # This was part of a previous fix, ensuring it's correctly handled.
                if 'timestamp' in order_data:
                    del order_data['timestamp']
                
                processed_orders.append(order_data)

            logging.info(f"/api/kds/orders: Processamento concluído. Retornando {len(processed_orders)} pedidos.")
            return jsonify(processed_orders)
        except OperationFailure as op_e: # More specific PyMongo operational error
            logging.exception(f"/api/kds/orders: Erro de operação do MongoDB (OperationFailure) ao buscar pedidos: {op_e.details}")
            return jsonify({"error": f"Erro de banco de dados ao carregar pedidos: {op_e.code}", "details": op_e.details}), 500
        except ConnectionFailure as conn_e: # More specific PyMongo connection error
            logging.exception(f"/api/kds/orders: Erro de conexão com MongoDB (ConnectionFailure) ao buscar pedidos: {conn_e}")
            return jsonify({"error": "Erro de conexão com o banco de dados ao carregar pedidos."}), 503
        except Exception as e:
            # This will catch other errors during the find, sort, or processing loop
            logging.exception("/api/kds/orders: Erro DENTRO DO TRY ao buscar/processar pedidos para a API KDS.")
            return jsonify({"error": "Erro ao carregar pedidos (interno)."}), 500
    else:
        # This case means orders_collection was None when the function was called
        logging.error("/api/kds/orders: orders_collection é None. Coleção de pedidos (MongoDB) não está disponível.")
        return jsonify({"error": "Serviço de banco de dados não disponível (orders_collection is None)."}), 503

# --- API Endpoint: Update KDS Order Status ---
@app.route('/api/kds/order/<order_id>/status', methods=['PUT'])
def update_kds_order_status(order_id):
    logging.info(f"PUT /api/kds/order/{order_id}/status: Iniciando atualização de status.")
    if orders_collection is None:
        logging.error(f"PUT /api/kds/order/{order_id}/status: orders_collection é None.")
        return jsonify({"error": "Serviço de banco de dados não disponível."}), 503

    data = request.get_json()
    new_status = data.get('status')

    if not new_status:
        logging.warning(f"PUT /api/kds/order/{order_id}/status: Novo status não fornecido no corpo da requisição.")
        return jsonify({"error": "Novo status é obrigatório."}), 400

    allowed_statuses = ["Em Preparo", "Pronto", "Cancelado"] # Adicione outros status se necessário
    if new_status not in allowed_statuses:
        logging.warning(f"PUT /api/kds/order/{order_id}/status: Status '{new_status}' inválido.")
        return jsonify({"error": f"Status inválido. Permitidos: {', '.join(allowed_statuses)}"}), 400

    try:
        obj_id = ObjectId(order_id)
    except Exception:
        logging.warning(f"PUT /api/kds/order/{order_id}/status: ID do pedido inválido.")
        return jsonify({"error": "ID do pedido inválido."}), 400

    try:
        result = orders_collection.update_one(
            {"_id": obj_id},
            {"$set": {"status": new_status, "last_updated": datetime.datetime.now(pytz.timezone('America/Sao_Paulo'))}}
        )

        if result.matched_count == 0:
            logging.warning(f"PUT /api/kds/order/{order_id}/status: Pedido não encontrado.")
            return jsonify({"error": "Pedido não encontrado."}), 404
        
        if result.modified_count == 0:
            # Isso pode acontecer se o status já for o novo_status
            logging.info(f"PUT /api/kds/order/{order_id}/status: Status do pedido já era '{new_status}'. Nenhuma alteração feita.")
            return jsonify({"message": f"Status do pedido já era '{new_status}'."}), 200


        logging.info(f"PUT /api/kds/order/{order_id}/status: Status do pedido atualizado para '{new_status}'.")
        return jsonify({"message": "Status do pedido atualizado com sucesso."}), 200

    except OperationFailure as op_e:
        logging.exception(f"PUT /api/kds/order/{order_id}/status: Erro de operação do MongoDB: {op_e.details}")
        return jsonify({"error": "Erro de banco de dados ao atualizar status."}), 500
    except Exception as e:
        logging.exception(f"PUT /api/kds/order/{order_id}/status: Erro inesperado: {e}")
        return jsonify({"error": "Erro interno ao atualizar status do pedido."}), 500


# --- Execução da Aplicação ---
if __name__ == '__main__':
    logging.info("Iniciando servidor Flask...")
    app.run(host='0.0.0.0', port=5000)