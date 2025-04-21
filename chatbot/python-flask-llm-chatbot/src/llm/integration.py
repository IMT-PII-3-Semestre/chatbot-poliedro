import requests
import json
import logging
import os

logging.basicConfig(level=logging.INFO)

class LLMIntegration:
    def __init__(self, ollama_url="http://localhost:11434/api/generate", model_name="deepseek-r1"):
        self.ollama_url = ollama_url
        self.model_name = model_name
        logging.info(f"LLMIntegration inicializado para o modelo '{self.model_name}' em {self.ollama_url}")
        self.base_context = self._build_base_context()

    def _load_menu_from_json(self):
        """Carrega o cardápio do arquivo menu.json."""
        current_dir = os.path.dirname(os.path.abspath(__file__))
        menu_path = os.path.join(current_dir, '..', 'menu.json') # Caminho relativo para src/menu.json
        try:
            with open(menu_path, 'r', encoding='utf-8') as f:
                menu_data = json.load(f)
            # Formata o menu para string (mantém em português para o LLM ver)
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
        """Constrói o prompt base com instruções, menu e exemplos."""
        menu_string = self._load_menu_from_json()

        instructions = f"""You are a friendly and efficient virtual assistant for the Poliedro Restaurant. Your goal is to take customer orders based on the available menu. Be clear, direct, and polite. Your final response MUST be in Brazilian Portuguese. Only generate the response for the 'Assistente:'. Do NOT reproduce the examples below.

**Current Menu (Cardápio Atual):**
{menu_string}

**Additional Instructions:**
- Respond naturally and grammatically correct in Brazilian Portuguese.
- Confirm the order with the customer before finalizing by repeating the items and asking if it's correct ("Correto?").
- If the customer asks for something not on the menu, politely inform them that the item is not available today ("não está disponível hoje").
- If the menu is unavailable (indicated by "Cardápio indisponível", "Erro ao carregar", etc.), state that clearly and do not ask what the user wants to order.
- Do not chat about other topics. Focus only on taking the order or providing information about the menu.
- Keep your answers concise.

--- EXAMPLES BELOW - DO NOT REPRODUCE ---

**Interaction Examples (Exemplos de Interação):**
(Note: Examples show the desired Portuguese output)

Cliente: oi
Assistente: Olá! Bem-vindo ao Restaurante Poliedro. Gostaria de ver o cardápio ou fazer um pedido?

Cliente: qual o cardapio?
Assistente: Claro! Nosso cardápio hoje é:\n{menu_string}\nO que você gostaria de pedir?

Cliente: tem pizza?
Assistente: Desculpe, não temos pizza em nosso cardápio hoje. Gostaria de pedir algum dos itens disponíveis?

Cliente: quero um hamburguer e uma batata frita
Assistente: Entendido. Um Hambúrguer Clássico e uma Batata Frita (Média). Correto?

Cliente: sim
Assistente: Ótimo! Pedido anotado. Algo mais?

Cliente: não, só isso
Assistente: Perfeito. Seu pedido foi registrado!

--- END OF EXAMPLES ---
"""
        return instructions

    def generate_response(self, user_input, conversation_history=None):
        """
        Gera uma resposta da API Ollama, construindo o contexto atualizado a cada chamada.
        """
        current_base_context = self._build_base_context()

        # Ensure the prompt clearly ends asking for the assistant's response
        full_prompt = f"{current_base_context}\n\nCliente: {user_input}\nAssistente:" # This structure is usually good
        logging.info(f"Enviando prompt completo para Ollama (início):\n{full_prompt[:500]}...")

        payload = {
            "model": self.model_name,
            "prompt": full_prompt,
            "stream": False,
            # You might also try adding a stop parameter if the above doesn't work
            # "options": {
            #     "stop": ["Cliente:", "\nCliente:"]
            # }
        }
        headers = {'Content-Type': 'application/json'}

        try:
            # Using the increased timeout
            response = requests.post(self.ollama_url, headers=headers, data=json.dumps(payload), timeout=180)
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