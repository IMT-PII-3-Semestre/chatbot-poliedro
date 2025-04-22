import logging

class ChatbotHandler:
    """
    Classe responsável por intermediar a comunicação entre a aplicação Flask
    e a integração com o LLM.
    """
    def __init__(self, llm_integration):
        """
        Inicializa o handler do chatbot.

        Args:
            llm_integration: Instância da classe LLMIntegration para interagir com o LLM.
        """
        if llm_integration is None:
            raise ValueError("llm_integration não pode ser None")
        self.llm_integration = llm_integration
        logging.info("ChatbotHandler inicializado.")

    def process_input(self, user_input, conversation_history=None):
        """
        Processa a entrada do usuário, interage com o LLM e retorna a resposta.

        Args:
            user_input (str): A mensagem enviada pelo usuário.
            conversation_history (list, optional): Lista de mensagens anteriores.
                                                   Defaults to None.

        Returns:
            str: A resposta gerada pelo LLM.
        """
        if not user_input:
            logging.warning("Entrada do usuário vazia recebida.")
            return "Por favor, diga algo."

        try:
            response = self.llm_integration.generate_response(user_input, conversation_history)
            return response
        except Exception as e:
            logging.exception(f"Erro ao processar entrada do usuário: {e}")
            return "Desculpe, ocorreu um erro interno ao processar sua mensagem."