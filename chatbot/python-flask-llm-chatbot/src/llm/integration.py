import requests
import json
import logging
import os  # Para encontrar o caminho do arquivo

logging.basicConfig(level=logging.INFO)

class LLMIntegration:
    def __init__(self, ollama_url="http://localhost:11434/api/generate", model_name="deepseek-r1"):
        self.ollama_url = ollama_url
        self.model_name = model_name
        logging.info(f"LLMIntegration inicializado para o modelo '{self.model_name}' em {self.ollama_url}")
        self.base_context = self._build_base_context()

    def _load_menu_from_json(self):
        # Constrói o caminho para menu.json relativo a este arquivo
        current_dir = os.path.dirname(os.path.abspath(__file__))
        menu_path = os.path.join(current_dir, '..', 'menu.json')  # Sobe um nível para src/
        try:
            with open(menu_path, 'r', encoding='utf-8') as f:
                menu_data = json.load(f)
            # Formata o menu para string
            menu_string = "\n".join([f"- {item['name']} (R$ {item['price']:.2f})" for item in menu_data])
            return menu_string
        except FileNotFoundError:
            logging.error(f"Arquivo menu.json não encontrado em {menu_path}")
            return "Cardápio indisponível no momento."
        except json.JSONDecodeError:
            logging.error(f"Erro ao decodificar o arquivo menu.json em {menu_path}")
            return "Erro ao carregar o cardápio."
        except Exception as e:
            logging.error(f"Erro inesperado ao carregar menu.json: {e}")
            return "Erro interno ao carregar o cardápio."

    def _build_base_context(self):
        menu_string = self._load_menu_from_json()  # Carrega do arquivo

        instructions = f"""Você é um assistente virtual amigável e eficiente do Restaurante Poliedro. Seu objetivo é anotar pedidos dos clientes com base no cardápio disponível. Seja claro e direto.

Cardápio Atual:
{menu_string}

Instruções Adicionais:
- Confirme o pedido com o cliente antes de finalizar.
- Se o cliente pedir algo fora do cardápio, informe educadamente que não está disponível.
- Não converse sobre outros assuntos. Foque apenas em anotar o pedido.
"""
        return instructions

    def generate_response(self, user_input, conversation_history=None):
        """
        Gera uma resposta da API Ollama com base na entrada do usuário,
        adicionando contexto de persona e cardápio.
        """
        # --- Constrói o prompt final ---
        # Adiciona o contexto base antes da pergunta do usuário
        # (Poderíamos adicionar histórico da conversa aqui também no futuro)
        full_prompt = f"{self.base_context}\n\nCliente: {user_input}\nAssistente:"  # Adiciona "Assistente:" para guiar a resposta

        logging.info(f"Enviando prompt completo para Ollama:\n{full_prompt}")  # Log do prompt completo

        payload = {
            "model": self.model_name,
            "prompt": full_prompt,  # Usa o prompt completo
            "stream": False
        }
        headers = {'Content-Type': 'application/json'}

        try:
            response = requests.post(self.ollama_url, headers=headers, data=json.dumps(payload), timeout=60)
            response.raise_for_status()

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