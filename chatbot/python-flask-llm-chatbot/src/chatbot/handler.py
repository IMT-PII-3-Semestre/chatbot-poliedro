class ChatbotHandler:
    def __init__(self, llm_integration):
        # Garante que llm_integration seja armazenado
        self.llm_integration = llm_integration

    def process_input(self, user_input):
        # Processa a entrada do usuário e gera uma resposta usando o LLM
        # Podemos adicionar mais lógica aqui depois (por exemplo, pré-processamento, gerenciamento de contexto)
        response = self.llm_integration.generate_response(user_input)
        return response

    def handle_request(self, user_input):
        # Lida com a solicitação recebida do usuário através do aplicativo Flask
        response_text = self.process_input(user_input)
        # Retorna a resposta em um formato de dicionário esperado pelo frontend
        return {
            'response': response_text
        }