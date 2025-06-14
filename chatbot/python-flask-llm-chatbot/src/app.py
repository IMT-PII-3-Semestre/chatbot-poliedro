import os
import json
import logging
from decimal import Decimal, InvalidOperation
from flask import Flask, request, jsonify, session
from flask_cors import CORS
from dotenv import load_dotenv
from pymongo import MongoClient
from pymongo.errors import ConnectionFailure, OperationFailure
from bson.objectid import ObjectId
from bson import errors as bson_errors # Para InvalidId
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
MONGODB_URI = os.getenv("MONGODB_URI")

# --- Configuração do MongoDB ---
mongo_client = None
db = None
orders_collection = None
menu_items_collection = None

if MONGODB_URI:
    try:
        mongo_client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=5000)
        mongo_client.admin.command('ping') # Verifica a conexão
        db = mongo_client.get_database("poliedro_chatbot_db")
        orders_collection = db.get_collection("orders")
        menu_items_collection = db.get_collection("menu_items")
        logging.info("Conexão com MongoDB estabelecida e coleções referenciadas (orders, menu_items).")
    except ConnectionFailure:
        logging.error("Falha ao conectar ao MongoDB: Verifique a URI de conexão e a disponibilidade do servidor.")
        # Garante que as coleções permaneçam None se a conexão falhar
        menu_items_collection = None
        orders_collection = None
        mongo_client = None
    except Exception as e:
        logging.exception(f"Erro inesperado ao configurar MongoDB: {e}")
        menu_items_collection = None
        orders_collection = None
        mongo_client = None
else:
    logging.warning("MONGODB_URI não configurada. A integração com MongoDB está desabilitada.")

# --- Inicialização dos Componentes ---
llm_integration = None
chatbot_handler = None
try:
    # Passa menu_items_collection para LLMIntegration
    llm_integration = LLMIntegration(
        ollama_url=OLLAMA_URL,
        model_name=OLLAMA_MODEL,
        menu_collection=menu_items_collection, # A LLMIntegration usará esta coleção
        timeout=OLLAMA_TIMEOUT,
        temperature=OLLAMA_TEMPERATURE
    )
    # O ChatbotHandler usa o llm_integration configurado
    chatbot_handler = ChatbotHandler(llm_integration=llm_integration)
    logging.info(f"Integração LLM e ChatbotHandler inicializados com sucesso para o modelo '{OLLAMA_MODEL}'.")
except Exception as e:
    logging.exception("Erro fatal durante a inicialização dos componentes.")
    # Garante que chatbot_handler seja None se a inicialização falhar
    chatbot_handler = None

# --- Função Auxiliar: Carregar Cardápio para o ChatbotHandler ---
def load_menu_data():
    """
    Carrega os dados do cardápio da coleção MongoDB.
    Retorna um dicionário mapeando nomes de itens (minúsculos) para {"original_name": str, "price": Decimal}.
    Retorna um dicionário vazio se houver erro ou a coleção não estiver disponível.
    """
    menu_data_for_handler = {}
    if menu_items_collection is None:
        logging.error("load_menu_data: menu_items_collection não está disponível.")
        return {}
    try:
        menu_list_from_db = list(menu_items_collection.find({}))
        for item in menu_list_from_db:
            if not isinstance(item, dict) or 'name' not in item or 'price' not in item:
                logging.warning(f"Item de menu do DB em formato inválido ignorado: {item}")
                continue
            try:
                original_name = str(item['name'])
                # Preços no MongoDB são armazenados como números (float).
                # Convertendo para Decimal para consistência interna no ChatbotHandler.
                price = Decimal(str(item['price']))
                if price < 0:
                    logging.warning(f"Item de menu do DB com preço negativo ignorado: {item}")
                    continue
                menu_data_for_handler[original_name.lower()] = {"original_name": original_name, "price": price}
            except (InvalidOperation, ValueError, TypeError) as item_error:
                logging.warning(f"Erro ao processar item de menu do DB {item}: {item_error}")
        return menu_data_for_handler
    except OperationFailure as op_e:
        logging.exception(f"load_menu_data: Erro de operação do MongoDB: {op_e.details}")
        return {}
    except Exception as e:
        logging.exception(f"load_menu_data: Erro inesperado ao carregar dados do cardápio do MongoDB: {e}")
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
    elif method == 'POST' and path == '/chat/reset_session':
        return "Requisição para resetar a sessão do chat"
    # Adicione outras descrições personalizadas conforme necessário
    return f"Requisição {method} para {path}"

# --- Decorador para Logar Após Cada Requisição ---
@app.after_request
def log_request_info(response):
    if not request: # Evita erro se o contexto da requisição não estiver disponível
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

    if chatbot_handler is None:
        logging.error("/chat: ChatbotHandler não inicializado.")
        return jsonify({"error": "Serviço de chatbot indisponível."}), 503

    if not user_input:
        return jsonify({"response": "Por favor, digite uma mensagem.", "cart": session.get('cart', [])}), 400

    if 'cart' not in session:
        session['cart'] = []
    if 'conversation_history' not in session:
        session['conversation_history'] = []
    if 'last_bot_message' not in session:
        session['last_bot_message'] = ""
    # session.get('awaiting_client_name') será usado para verificar o estado

    final_response_data = {"response": None, "cart": list(session.get('cart', []))}
    current_menu_data = load_menu_data() 
    brasilia_tz = pytz.timezone('America/Sao_Paulo')

    # Cenário 1: Bot estava aguardando o nome do cliente
    if session.get('awaiting_client_name'):
        client_name = user_input # A mensagem atual do usuário é considerada o nome
        session.pop('awaiting_client_name', None) # Limpa a flag

        if not session.get('cart'):
            final_response_data["response"] = "Seu carrinho está vazio. Não posso finalizar um pedido sem itens."
            session['conversation_history'] = [] # Limpa o histórico da conversa, pois não podemos finalizar
            logging.info(f"Pedido não finalizado para {client_name} porque o carrinho está vazio.")
        else:
            order_details_text, total_calculated = chatbot_handler.format_order_details(
                session['cart'], current_menu_data, include_total=True, for_confirmation=False
            )
            final_response_data["response"] = f"Ótimo, {client_name}! Seu pedido foi anotado e enviado para a cozinha!"
            final_order_payload = {
                "client_name": client_name, # Nome do cliente adicionado
                "items": list(session['cart']),
                "total": str(total_calculated),
                "order_details_text": order_details_text,
                "timestamp": datetime.datetime.now(brasilia_tz),
                "status": "Pendente"
            }
            final_response_data['final_order'] = final_order_payload
    
            if orders_collection is not None:
                try:
                    insert_result = orders_collection.insert_one(final_order_payload)
                    logging.info(f"Pedido finalizado para {client_name} e salvo no MongoDB com ID: {insert_result.inserted_id}")
                    if '_id' in final_order_payload: # Para retornar ao frontend se necessário
                        final_order_payload['_id'] = str(final_order_payload['_id'])
                except OperationFailure as e:
                    logging.error(f"Falha ao salvar pedido no MongoDB para {client_name}: {e.details}")
                except Exception as e:
                    logging.exception(f"Erro inesperado ao salvar pedido no MongoDB para {client_name}.")
            else:
                logging.warning(f"MongoDB não configurado. Pedido para {client_name} não foi salvo no banco de dados.")
    
            logging.info(f"Pedido finalizado para {client_name}: {session['cart']}")
            session['cart'] = [] # Limpa o carrinho após pedido bem-sucedido
            session['conversation_history'] = [] # Limpa o histórico da conversa para um novo começo
            session['last_bot_message'] = "" # Limpa a última mensagem do bot
        
    else: # Bot NÃO estava aguardando um nome, prossegue com a lógica normal
        last_bot_message_for_confirmation = session.get('last_bot_message', '').strip()
        is_direct_sim_confirmation = user_input.lower() == "sim" and \
                                     last_bot_message_for_confirmation.endswith("Correto?")
        is_direct_nao_confirmation = user_input.lower() == "não" and \
                                     last_bot_message_for_confirmation.endswith("Correto?")

        if is_direct_sim_confirmation:
            logging.info("Confirmação 'sim' direta recebida do frontend.")
            if not session.get('cart'):
                final_response_data["response"] = "Seu carrinho está vazio. Adicione itens antes de finalizar."
            else:
                # Em vez de finalizar diretamente, define a flag e pede o nome
                session['awaiting_client_name'] = True
                final_response_data["response"] = "Entendido. Para finalizar, por favor, me diga seu nome."
                # Carrinho e histórico são preservados. Pedido ainda não foi salvo.
        
        elif is_direct_nao_confirmation:
            logging.info("Confirmação 'não' direta recebida do frontend.")
            final_response_data["response"] = "Entendido. O que você gostaria de alterar ou adicionar?"
            
        else: # Não é uma confirmação direta "sim" ou "não", processar com LLM/Handler
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
                    # A resposta do handler (perguntando "Correto?") já está em final_response_data["response"]

                elif action == "finalize_order_confirmed": # LLM ou handler decidiu finalizar
                    logging.info("Handler indica que o pedido foi confirmado.")
                    if not session.get('cart'):
                        final_response_data["response"] = "Seu carrinho está vazio. Adicione itens antes de finalizar."
                    else:
                        # Em vez de finalizar diretamente, define a flag e pede o nome
                        session['awaiting_client_name'] = True
                        # Sobrescreve a mensagem de finalização do LLM para pedir o nome
                        final_response_data["response"] = "Entendido. Para finalizar, por favor, me diga seu nome."
                
                elif action == "clear_cart":
                    logging.info("Carrinho limpo conforme instrução do handler.")
                    session['cart'] = [] # Garante que o carrinho seja limpo na sessão

            except Exception as e:
                logging.exception("Erro ao chamar chatbot_handler.process_input ou ao processar sua saída.")
                final_response_data["response"] = "Desculpe, ocorreu um erro interno ao processar sua mensagem. Tente novamente mais tarde."

    # Lógica comum para atualizar a sessão e retornar a resposta
    final_response_data["cart"] = list(session.get('cart', [])) # Reflete as alterações no carrinho (ex: limpo após o pedido)
    session['last_bot_message'] = final_response_data.get("response")

    # Adiciona a interação atual ao histórico.
    # Se um pedido foi feito com sucesso, session['conversation_history'] foi limpo.
    # Então, isso adicionará a mensagem final do usuário (nome) e a confirmação do bot como o início de um novo histórico.
    if user_input:
         session['conversation_history'].append({"role": "user", "content": user_input})
    if final_response_data.get("response"):
        session['conversation_history'].append({"role": "assistant", "content": final_response_data["response"]})
    
    # Limita o tamanho do histórico. Isso se aplica mesmo se o histórico acabou de ser limpo (será curto).
    MAX_HISTORY_LEN = 10 
    if len(session.get('conversation_history', [])) > MAX_HISTORY_LEN:
        session['conversation_history'] = session['conversation_history'][-MAX_HISTORY_LEN:]

    session.modified = True 
    return jsonify(final_response_data)

# --- Endpoint para Resetar a Sessão do Chat ---
@app.route('/chat/reset_session', methods=['POST'])
def reset_chat_session():
    session.pop('conversation_history', None)
    session.pop('cart', None)
    session.pop('last_bot_message', None)
    logging.info("Sessão do chat resetada (histórico, carrinho, última mensagem do bot).")
    return jsonify({"message": "Sessão do chat resetada com sucesso."}), 200

# --- Endpoint: Gerenciar Cardápio (KDS Admin) ---
@app.route('/menu', methods=['GET', 'POST'])
def handle_menu_kds_admin():
    if request.method == 'GET':
        if menu_items_collection is None:
            logging.error("GET /menu: menu_items_collection não está disponível.")
            return jsonify({"error": "Serviço de cardápio (DB) não disponível."}), 503
        try:
            logging.info("GET /menu: Tentando buscar itens do menu do MongoDB.")
            menu_from_db = list(menu_items_collection.find({}))
            logging.info(f"GET /menu: Encontrados {len(menu_from_db)} itens no DB.")
            
            menu_list_serializable = []
            for item_index, item in enumerate(menu_from_db):
                if not isinstance(item, dict):
                    logging.warning(f"GET /menu: Item {item_index} do DB não é um dicionário: {item}")
                    continue

                item_id = item.get('_id')
                item_name_raw = item.get("name")
                item_price_raw = item.get("price")

                if not item_id: # Valida _id
                    logging.warning(f"GET /menu: Item {item_index} não possui '_id': {item}")
                    continue # Pular item sem ID
                
                # Valida nome
                item_name_str = str(item_name_raw) if item_name_raw is not None else "Nome Indisponível"

                # Valida preço
                item_price_str = "0.00" # Preço padrão
                if item_price_raw is not None:
                    try:
                        # Garante que o preço seja um número antes de formatar, depois converte para string para JSON.
                        numeric_price = float(item_price_raw)
                        item_price_str = f"{numeric_price:.2f}" # Formata para 2 casas decimais
                    except (ValueError, TypeError) as price_conversion_error:
                        logging.warning(f"GET /menu: Não foi possível converter o preço '{item_price_raw}' para float para o item ID {item_id}. Erro: {price_conversion_error}. Usando '0.00'.")
                else: # item_price_raw é None
                    logging.warning(f"GET /menu: Item ID {item_id} não possui 'price'. Usando '0.00'.")

                menu_list_serializable.append({
                    "id": str(item_id),
                    "name": item_name_str.title(),
                    "price": item_price_str
                })
            
            logging.info(f"GET /menu: Retornando {len(menu_list_serializable)} itens serializados.")
            return jsonify({"menu": menu_list_serializable})
        
        except OperationFailure as op_e:
            logging.exception(f"GET /menu: Erro de operação do MongoDB ao buscar cardápio: {op_e.details if hasattr(op_e, 'details') else op_e}")
            return jsonify({"error": f"Erro de banco de dados ao carregar cardápio: {op_e}"}), 500
        except Exception as e:
            logging.exception("GET /menu: Erro inesperado ao preparar dados do menu para resposta.")
            return jsonify({"error": f"Erro interno ao processar cardápio: {str(e)}"}), 500

    elif request.method == 'POST':
        if menu_items_collection is None:
            return jsonify({"error": "Serviço de cardápio (DB) não disponível."}), 503
        try:
            # O frontend kds.js envia dados no formato { menu: [...] }.
            request_data = request.json
            new_menu_list_from_request = request_data.get('menu')

            if not isinstance(new_menu_list_from_request, list):
                 logging.warning(f"POST /menu: Recebido formato inválido. Esperado: lista dentro de 'menu'. Recebido: {type(new_menu_list_from_request)}")
                 return jsonify({"error": "Formato de dados inválido. Esperado uma lista de itens na chave 'menu'."}), 400

            validated_menu_to_save_to_db = []
            for item_from_request in new_menu_list_from_request:
                if not isinstance(item_from_request, dict) or 'name' not in item_from_request or 'price' not in item_from_request:
                    logging.warning(f"POST /menu: Item inválido na lista recebida: {item_from_request}")
                    return jsonify({"error": f"Item inválido na lista: {item_from_request}. Cada item deve ser um dicionário com 'name' e 'price'."}), 400
                try:
                    name = str(item_from_request['name']).strip()
                    price_str = str(item_from_request['price']).replace(',', '.') # Aceita vírgula como separador decimal
                    price = Decimal(price_str) # Valida e converte para Decimal
                    
                    if not name:
                         return jsonify({"error": "Nome do item não pode ser vazio."}), 400
                    if price < 0:
                         return jsonify({"error": f"Preço inválido para o item '{name}'. Preço não pode ser negativo."}), 400
                    
                    # Armazena o preço como float no MongoDB para melhor compatibilidade geral.
                    validated_menu_to_save_to_db.append({"name": name, "price": float(price)})
                except (InvalidOperation, ValueError, TypeError):
                     logging.warning(f"POST /menu: Preço inválido para o item: {item_from_request}")
                     return jsonify({"error": f"Preço inválido para o item '{item_from_request.get('name')}': {item_from_request.get('price')}"}), 400
            
            # Limpa a coleção existente e insere os novos itens.
            menu_items_collection.delete_many({})
            if validated_menu_to_save_to_db: # Apenas insere se a lista não estiver vazia.
                menu_items_collection.insert_many(validated_menu_to_save_to_db)
            
            logging.info(f"POST /menu: Cardápio atualizado no MongoDB com {len(validated_menu_to_save_to_db)} itens.")
            return jsonify({"message": "Cardápio atualizado com sucesso!"}), 200
        except OperationFailure as op_e:
            logging.exception(f"POST /menu: Erro de operação do MongoDB: {op_e.details if hasattr(op_e, 'details') else op_e}")
            return jsonify({"error": "Erro de banco de dados ao salvar cardápio."}), 500
        except Exception as e:
            logging.exception("POST /menu: Erro inesperado ao salvar o novo cardápio.")
            return jsonify({"error": "Erro interno ao salvar cardápio."}), 500

# --- API Endpoint: Excluir Item do Cardápio (KDS Admin) ---
@app.route('/api/menu/items/<item_id>', methods=['DELETE'])
def delete_menu_item_kds_admin(item_id):
    if menu_items_collection is None:
        return jsonify({"error": "Serviço de cardápio (DB) não disponível."}), 503
    try:
        obj_id = ObjectId(item_id)
        result = menu_items_collection.delete_one({"_id": obj_id})
        if result.deleted_count == 1:
            logging.info(f"DELETE /api/menu/items/{item_id}: Item excluído com sucesso.")
            return jsonify({"message": "Item excluído com sucesso!"}), 200
        else:
            logging.warning(f"DELETE /api/menu/items/{item_id}: Item não encontrado para exclusão.")
            return jsonify({"error": "Item não encontrado."}), 404
    except bson_errors.InvalidId: 
        logging.warning(f"DELETE /api/menu/items/{item_id}: ID de item inválido.")
        return jsonify({"error": "ID de item inválido."}), 400
    except OperationFailure as op_e:
        logging.exception(f"DELETE /api/menu/items/{item_id}: Erro de operação do MongoDB: {op_e.details if hasattr(op_e, 'details') else op_e}")
        return jsonify({"error": "Erro de banco de dados ao excluir item."}), 500
    except Exception as e:
        logging.exception(f"DELETE /api/menu/items/{item_id}: Erro inesperado: {e}")
        return jsonify({"error": "Erro interno ao excluir item do cardápio."}), 500

# --- API Endpoint: Pedidos KDS ---
@app.route('/api/kds/orders', methods=['GET'])
def api_kds_orders():
    requested_status = request.args.get('status', 'Pendente') # Padrão para 'Pendente'
    
    valid_statuses_for_fetch = ['Pendente', 'Em Preparo', 'Pronto']
    if requested_status not in valid_statuses_for_fetch:
        logging.warning(f"/api/kds/orders: Status de busca inválido '{requested_status}'.")
        return jsonify({"error": f"Status de busca inválido. Permitidos: {', '.join(valid_statuses_for_fetch)}"}), 400

    logging.info(f"/api/kds/orders: Iniciando busca de pedidos com status '{requested_status}'. orders_collection is {'None' if orders_collection is None else 'válida'}.")
    if orders_collection is not None:
        try:
            logging.info(f"/api/kds/orders: Tentando buscar e ordenar pedidos com status '{requested_status}' do MongoDB.")
            # Ordena pelo mais antigo primeiro para 'Pendente' e 'Em Preparo',
            # e mais recente primeiro para 'Pronto'.
            sort_order = 1 if requested_status in ['Pendente', 'Em Preparo'] else -1
            
            kds_orders_cursor = orders_collection.find({"status": requested_status}).sort("timestamp", sort_order)
            kds_orders = list(kds_orders_cursor) # Executa a consulta
            logging.info(f"/api/kds/orders: Encontrados {len(kds_orders)} pedidos com status '{requested_status}'.")
            
            processed_orders = []
            for order_data in kds_orders: 
                order_data['_id'] = str(order_data['_id']) # Converte ObjectId para string
                
                timestamp_obj = order_data.get('timestamp')
                if isinstance(timestamp_obj, datetime.datetime):
                    # O timestamp_obj do MongoDB é um datetime ingênuo (sem fuso) representando UTC.
                    # Torna-o ciente do UTC antes de converter para string ISO.
                    aware_utc_timestamp = timestamp_obj.replace(tzinfo=datetime.timezone.utc)
                    order_data['timestamp_iso'] = aware_utc_timestamp.isoformat()
                else:
                    if timestamp_obj is not None:
                        logging.warning(f"/api/kds/orders: Timestamp para pedido {order_data['_id']} não é um objeto datetime, é {type(timestamp_obj)}.")
                        order_data['timestamp_iso'] = str(timestamp_obj) # Fallback
                    else:
                        order_data['timestamp_iso'] = None
                
                # Remove o objeto datetime original para evitar problemas de serialização JSON.
                if 'timestamp' in order_data:
                    del order_data['timestamp']
                
                processed_orders.append(order_data)

            logging.info(f"/api/kds/orders: Processamento concluído. Retornando {len(processed_orders)} pedidos.")
            return jsonify(processed_orders)
        except OperationFailure as op_e: 
            logging.exception(f"/api/kds/orders: Erro de operação do MongoDB (OperationFailure) ao buscar pedidos: {op_e.details if hasattr(op_e, 'details') else op_e}")
            return jsonify({"error": f"Erro de banco de dados ao carregar pedidos: {op_e.code if hasattr(op_e, 'code') else 'N/A'}", "details": op_e.details if hasattr(op_e, 'details') else str(op_e)}), 500
        except ConnectionFailure as conn_e: 
            logging.exception(f"/api/kds/orders: Erro de conexão com MongoDB (ConnectionFailure) ao buscar pedidos: {conn_e}")
            return jsonify({"error": "Erro de conexão com o banco de dados ao carregar pedidos."}), 503
        except Exception as e:
            logging.exception("/api/kds/orders: Erro DENTRO DO TRY ao buscar/processar pedidos para a API KDS.")
            return jsonify({"error": "Erro ao carregar pedidos (interno)."}), 500
    else:
        logging.error("/api/kds/orders: orders_collection é None. Coleção de pedidos (MongoDB) não está disponível.")
        return jsonify({"error": "Serviço de banco de dados não disponível (orders_collection is None)."}), 503

# --- API Endpoint: Atualizar Status do Pedido KDS ---
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

    allowed_statuses = ["Em Preparo", "Pronto", "Cancelado"] 
    if new_status not in allowed_statuses:
        logging.warning(f"PUT /api/kds/order/{order_id}/status: Status '{new_status}' inválido.")
        return jsonify({"error": f"Status inválido. Permitidos: {', '.join(allowed_statuses)}"}), 400

    try:
        obj_id = ObjectId(order_id)
    except bson_errors.InvalidId: 
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
            # Isso pode acontecer se o status já for o new_status.
            logging.info(f"PUT /api/kds/order/{order_id}/status: Status do pedido já era '{new_status}'. Nenhuma alteração feita.")
            return jsonify({"message": f"Status do pedido já era '{new_status}'."}), 200

        logging.info(f"PUT /api/kds/order/{order_id}/status: Status do pedido atualizado para '{new_status}'.")
        return jsonify({"message": "Status do pedido atualizado com sucesso."}), 200

    except OperationFailure as op_e:
        logging.exception(f"PUT /api/kds/order/{order_id}/status: Erro de operação do MongoDB: {op_e.details if hasattr(op_e, 'details') else op_e}")
        return jsonify({"error": "Erro de banco de dados ao atualizar status."}), 500
    except Exception as e:
        logging.exception(f"PUT /api/kds/order/{order_id}/status: Erro inesperado: {e}")
        return jsonify({"error": "Erro interno ao atualizar status do pedido."}), 500


# --- Execução da Aplicação ---
if __name__ == '__main__':
    logging.info("Iniciando servidor Flask...")
    app.run(host='0.0.0.0', port=5000)