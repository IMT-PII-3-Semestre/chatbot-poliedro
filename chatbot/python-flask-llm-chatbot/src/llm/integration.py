import requests
import json
import logging  # Opcional: para melhor logging de erros

logging.basicConfig(level=logging.INFO)

class LLMIntegration: # Armazena a URL do Ollama e o nome do modelo
    def __init__(self, ollama_url="http://localhost:11434/api/generate", model_name="deepseek-r1"):
        self.ollama_url = ollama_url
        self.model_name = model_name
        logging.info(f"LLMIntegration inicializado para o modelo '{self.model_name}' em {self.ollama_url}")

    def generate_response(self, user_input, conversation_history=None):
        """
        Gera uma resposta da API Ollama com base na entrada do usuário e histórico opcional.
        """
        logging.info(f"Enviando prompt para Ollama: {user_input}")
        payload = {
            "model": self.model_name,
            "prompt": user_input,
            "stream": False  # Obter a resposta completa de uma vez
        }
        headers = {'Content-Type': 'application/json'}

        try:
            response = requests.post(self.ollama_url, headers=headers, data=json.dumps(payload), timeout=60)  # Adicionado timeout
            response.raise_for_status()  # Lança uma exceção para códigos de status ruins (4xx ou 5xx)

            response_data = response.json()
            generated_text = response_data.get('response', '').strip()
            logging.info(f"Resposta recebida do Ollama: {generated_text}")
            return generated_text

        except requests.exceptions.RequestException as e:
            logging.error(f"Erro ao chamar a API Ollama: {e}")
            return "Desculpe, encontrei um erro ao tentar acessar o modelo de linguagem."
        except json.JSONDecodeError:
            logging.error(f"Erro ao decodificar a resposta JSON do Ollama: {response.text}")
            return "Desculpe, recebi uma resposta inválida do modelo de linguagem."
        except Exception as e:
            logging.error(f"Ocorreu um erro inesperado: {e}")
            return "Desculpe, ocorreu um erro inesperado."