import requests
import json
import logging
import os
from decimal import Decimal, InvalidOperation

logging.basicConfig(level=logging.INFO)

class LLMIntegration:
    def __init__(self, ollama_url, model_name, timeout=60, temperature=0.5):
        self.ollama_url = ollama_url
        self.model_name = model_name
        self.timeout = timeout  # Armazene o timeout
        self.temperature = temperature  # Armazene a temperatura
        logging.info(f"LLMIntegration inicializado para o modelo '{self.model_name}' em {self.ollama_url} com timeout={self.timeout}, temp={self.temperature}")

    def _load_menu_from_json(self):
        """Carrega o cardápio do arquivo menu.json.

        Returns:
            str: String formatada do cardápio em caso de sucesso.
            None: Em caso de erro ao carregar ou parsear o arquivo, ou se o menu estiver vazio/inválido.
        """
        current_dir = os.path.dirname(os.path.abspath(__file__))
        menu_path = os.path.join(current_dir, '..', 'menu.json')

        if not os.path.exists(menu_path):
            logging.error(f"Arquivo menu.json não encontrado em {menu_path}")
            return None  # Retorna None se o arquivo não existe

        try:
            with open(menu_path, 'r', encoding='utf-8') as f:
                menu_data = json.load(f)

            if not isinstance(menu_data, list):
                logging.error(f"Formato inválido no menu.json: esperado uma lista, encontrado {type(menu_data)}.")
                return None  # Retorna None se o formato não for lista

            menu_items_formatted = []
            for item in menu_data:
                if isinstance(item, dict) and 'name' in item and 'price' in item:
                    try:
                        price = Decimal(str(item['price']))
                        if price >= 0:  # Garante que o preço não seja negativo
                            menu_items_formatted.append(f"- {item['name']} (R$ {price:.2f})")
                        else:
                            logging.warning(f"Ignorando item com preço negativo no menu: {item}")
                    except (InvalidOperation, ValueError, TypeError):
                        logging.warning(f"Ignorando item com preço inválido no menu: {item}")
                else:
                    logging.warning(f"Ignorando item mal formatado no menu: {item}")

            if not menu_items_formatted:
                logging.warning("Nenhum item válido encontrado no cardápio após o parse.")
                return None  # Retorna None se nenhum item válido foi encontrado

            return "\n".join(menu_items_formatted)  # Retorna a string formatada apenas em caso de sucesso

        except json.JSONDecodeError:
            logging.exception(f"Erro ao decodificar o arquivo menu.json em {menu_path}")
            return None  # Retorna None em caso de erro de JSON
        except Exception as e:
            logging.exception(f"Erro inesperado ao carregar menu.json: {e}")
            return None  # Retorna None para qualquer outra exceção

    def _build_base_context(self):
        """Constrói o prompt base com instruções, menu atualizado e exemplos,
           ou um prompt de erro se o menu não puder ser carregado."""
        menu_string = self._load_menu_from_json()

        # Verifica se o carregamento do menu falhou
        if menu_string is None:
            logging.error("Falha ao carregar o menu. Construindo prompt de erro para o LLM.")
            # Prompt mínimo informando o LLM sobre o problema
            instructions = """You are a virtual assistant for the Poliedro Restaurant.
ATTENTION: The menu could not be loaded due to an internal error.
Your task is to politely inform the user that the menu is currently unavailable and you cannot take orders at this moment.
Respond ONLY in Brazilian Portuguese. Example: "Desculpe, o cardápio está indisponível no momento e não consigo anotar pedidos. Por favor, tente novamente mais tarde."
Do NOT ask what the user wants. Do NOT mention the error details.
Assistente:"""  # Adiciona o início da resposta esperada
            return instructions

        # Se menu_string não for None, o menu foi carregado com sucesso. Construir prompt completo:
        logging.info("Menu carregado com sucesso. Construindo prompt completo para o LLM.")
        instructions = f"""You are a friendly and efficient virtual assistant for the Poliedro Restaurant. Your goal is to take customer orders based on the available menu. Be clear, direct, and polite. Your final response MUST be in Brazilian Portuguese. Only generate the response for the 'Assistente:'. Do NOT reproduce the examples below.

**Current Menu (Cardápio Atual):**
{menu_string}

**Additional Instructions:**
- Respond naturally and grammatically correct in Brazilian Portuguese.
- When the customer adds items, confirm by repeating the items as a bulleted list and asking if it's correct ("Correto?"). Use the format "Nx Item Name" for each item in the list. Start the confirmation with "Entendido. Você pediu:" followed by the list on new lines.
- If the customer asks for something not on the menu, politely inform them that the item is not available today ("não está disponível hoje").
- If the menu is unavailable (indicated by "Cardápio indisponível", "Erro ao carregar", etc.), state that clearly and do not ask what the user wants to order.
- Do not chat about other topics. Focus only on taking the order or providing information about the menu.
- Keep your answers concise.
- **Finalizing Order:** When the user confirms the order is complete (e.g., says 'sim', 'correto', 'só isso', 'finalizar' AFTER you asked 'Correto?'), you MUST respond EXACTLY in this format: "Ótimo! Pedido anotado: [List of confirmed items, EACH prefixed with quantity like '1x Item Name', separated by comma and space]. Total: R$ XX.XX. Seu pedido foi enviado para a cozinha!". Calculate XX.XX based on the menu prices for the confirmed items. Example: "Ótimo! Pedido anotado: 1x Hambúrguer Clássico, 1x Refrigerante Lata. Total: R$ 20.50. Seu pedido foi enviado para a cozinha!"

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
Assistente: Entendido. Você pediu:
- 1x Hambúrguer Clássico
- 1x Batata Frita (Média)
Correto?

Cliente: sim
Assistente: Ótimo! Pedido anotado: 1x Hambúrguer Clássico, 1x Batata Frita (Média). Total: R$ 23.50. Seu pedido foi enviado para a cozinha!

Cliente: quero um refri e dois teste 3
Assistente: Entendido. Você pediu:
- 1x Refrigerante Lata
- 2x teste 3
Correto?

Cliente: sim, só isso
Assistente: Ótimo! Pedido anotado: 1x Refrigerante Lata, 2x teste 3. Total: R$ 11.00. Seu pedido foi enviado para a cozinha!

--- END OF EXAMPLES ---
"""
        return instructions

    def generate_response(self, user_input, conversation_history=None):
        """
        Gera uma resposta da API Ollama, construindo o contexto atualizado a cada chamada.
        """
        current_base_context = self._build_base_context()

        # Adiciona a entrada atual do usuário ao prompt
        # Nota: conversation_history não está sendo usado atualmente, mas poderia ser adicionado aqui.
        full_prompt = f"{current_base_context}\n\nCliente: {user_input}\nAssistente:"
        logging.info(f"Enviando prompt para Ollama (modelo: {self.model_name}, início):\n{full_prompt[:500]}...")

        payload = {
            "model": self.model_name,
            "prompt": full_prompt,
            "stream": False,
            "options": {
                "temperature": self.temperature,  # Use os valores armazenados no self
                "stop": ["Cliente:", "\nCliente:", "\n\nCliente:"]
            }
        }
        headers = {'Content-Type': 'application/json'}

        try:
            response = requests.post(self.ollama_url, headers=headers, data=json.dumps(payload), timeout=self.timeout)  # Use o timeout armazenado no self
            response.raise_for_status()  # Lança exceção para erros HTTP (4xx ou 5xx)
            response_data = response.json()

            # Limpa a resposta removendo potenciais tokens de parada no final
            generated_text = response_data.get('response', '').strip()
            for stop_token in payload.get("options", {}).get("stop", []):
                if generated_text.endswith(stop_token):
                    generated_text = generated_text[:-len(stop_token)].strip()

            logging.info(f"Resposta recebida do Ollama: '{generated_text}'")
            return generated_text
        except requests.exceptions.Timeout:
            logging.error(f"Timeout ({self.timeout}s) ao chamar a API Ollama em {self.ollama_url}")
            return "Desculpe, o serviço demorou muito para responder. Tente novamente."
        except requests.exceptions.RequestException as e:
            logging.exception(f"Erro de rede ou HTTP ao chamar a API Ollama: {e}")
            return "Desculpe, não consegui me conectar ao serviço de chat no momento."
        except json.JSONDecodeError:
            logging.exception(f"Erro ao decodificar a resposta JSON do Ollama: {response.text}")
            return "Desculpe, recebi uma resposta inválida do serviço de chat."
        except Exception as e:
            logging.exception("Ocorreu um erro inesperado na integração com o LLM.")
            return "Desculpe, ocorreu um erro inesperado."