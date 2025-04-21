class ChatbotHandler:
    """
    Classe responsável por intermediar a comunicação entre a aplicação Flask
    e a integração com o LLM.
    """
    def __init__(self, llm_integration):
        """
        Inicializa o handler com uma instância da integração LLM.

        Args:
            llm_integration: Objeto responsável pela comunicação com o LLM.
        """
        if llm_integration is None:
             raise ValueError("llm_integration não pode ser None")
        self.llm_integration = llm_integration

    def process_input(self, user_input):
        """
        Processa a entrada do usuário, chama o LLM para gerar uma resposta.

        Args:
            user_input (str): A mensagem enviada pelo usuário.

        Returns:
            str: A resposta gerada pelo LLM ou uma mensagem de erro.
        """
        # Delega a geração da resposta para a classe de integração LLM
        # Futuramente, pode incluir lógica adicional como gerenciamento de histórico, pré/pós-processamento, etc.
        response = self.llm_integration.generate_response(user_input)
        return response