from flask import Flask, request, jsonify
from flask_cors import CORS
from chatbot.handler import ChatbotHandler
from llm.integration import LLMIntegration
import os
import json
import logging

app = Flask(__name__)
CORS(app)  # Habilita CORS para todas as rotas

logging.basicConfig(level=logging.INFO)

# --- Configuração ---
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434/api/generate")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "mistral")  # Define 'mistral' como o modelo padrão se a variável de ambiente não estiver definida
MENU_FILE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'menu.json')  # Define o caminho absoluto para o arquivo de cardápio

# --- Inicialização ---
llm_integration = LLMIntegration(ollama_url=OLLAMA_URL, model_name=OLLAMA_MODEL)
chatbot_handler = ChatbotHandler(llm_integration=llm_integration)

# --- Endpoint para Chat ---
@app.route('/chat', methods=['POST'])
def chat():
    data = request.json
    user_input = data.get('message')

    if not user_input:
        return jsonify({'error': 'Nenhuma mensagem fornecida'}), 400

    # O handler utiliza a instância de LLMIntegration para gerar a resposta
    response_data = chatbot_handler.handle_request(user_input)

    if 'response' not in response_data:
        logging.error("Handler não retornou uma chave 'response'")
        return jsonify({'error': 'Falha ao obter resposta do handler'}), 500

    return jsonify(response_data)

# --- Endpoints para Gerenciar Menu ---

@app.route('/menu', methods=['GET'])
def get_menu():
    """Retorna o conteúdo atual do menu.json."""
    try:
        with open(MENU_FILE_PATH, 'r', encoding='utf-8') as f:
            menu_data = json.load(f)
        return jsonify(menu_data)
    except FileNotFoundError:
        logging.error(f"API GET /menu: Arquivo menu.json não encontrado em {MENU_FILE_PATH}")
        return jsonify({'error': 'Arquivo de cardápio não encontrado'}), 404
    except json.JSONDecodeError:
        logging.error(f"API GET /menu: Erro ao decodificar menu.json em {MENU_FILE_PATH}")
        return jsonify({'error': 'Erro ao ler o arquivo de cardápio'}), 500
    except Exception as e:
        logging.error(f"API GET /menu: Erro inesperado ao ler menu.json: {e}")
        return jsonify({'error': 'Erro interno ao obter cardápio'}), 500

@app.route('/menu', methods=['POST'])
def update_menu():
    """Recebe um novo cardápio (lista de itens JSON) e sobrescreve o menu.json."""
    new_menu_data = request.json

    # Validação básica do formato recebido
    if not isinstance(new_menu_data, list):
        return jsonify({'error': 'Formato de cardápio inválido. Esperado uma lista de itens.'}), 400

    try:
        # Sobrescreve o arquivo com os novos dados
        with open(MENU_FILE_PATH, 'w', encoding='utf-8') as f:
            json.dump(new_menu_data, f, ensure_ascii=False, indent=4)
        logging.info(f"API POST /menu: Arquivo menu.json atualizado com sucesso.")
        return jsonify({'message': 'Cardápio atualizado com sucesso'}), 200
    except Exception as e:
        logging.error(f"API POST /menu: Erro inesperado ao escrever menu.json: {e}")
        return jsonify({'error': 'Erro interno ao salvar o cardápio'}), 500

if __name__ == '__main__':
    # Executa o servidor Flask em modo debug (útil para desenvolvimento)
    app.run(host='0.0.0.0', port=5000, debug=True)