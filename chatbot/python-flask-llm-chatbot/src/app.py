from flask import Flask, request, jsonify
from flask_cors import CORS
from chatbot.handler import ChatbotHandler
from llm.integration import LLMIntegration
import os  # Opcional: Para poder configurar a partir de variáveis de ambiente

app = Flask(__name__)
CORS(app)  # Habilita o CORS para todas as rotas, permitindo requisições da origem do seu frontend

# --- Configuração ---
# Você pode obter estes valores de variáveis de ambiente ou codificá-los diretamente
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434/api/generate")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "deepseek-r1")

# --- Inicialização ---
llm_integration = LLMIntegration(ollama_url=OLLAMA_URL, model_name=OLLAMA_MODEL)
# Passa a instância llm_integration para o handler
chatbot_handler = ChatbotHandler(llm_integration=llm_integration)

@app.route('/chat', methods=['POST'])
def chat():
    data = request.json
    user_input = data.get('message')
    # Aqui podemos querer passar o histórico da conversa ou o estado do frontend
    # conversation_history = data.get('history')

    if not user_input:
        return jsonify({'error': 'Nenhuma mensagem fornecida'}), 400

    # Chama o método apropriado no handler
    # Assumindo que handle_request recebe a entrada e retorna um dicionário
    response_data = chatbot_handler.handle_request(user_input)

    # Garante que a resposta esteja no formato esperado (ex: {'response': 'texto'})
    if 'response' not in response_data:
        # Lida com casos onde o handler pode retornar outra coisa ou falhar
        return jsonify({'error': 'Falha ao obter resposta do handler'}), 500

    return jsonify(response_data)  # Retorna o dicionário diretamente

if __name__ == '__main__':
    #  0.0.0.0 para torná-lo acessível de outros dispositivos na rede
    # A porta padrão é 5000
    app.run(host='0.0.0.0', port=5000, debug=True)