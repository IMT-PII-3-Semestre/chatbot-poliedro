import requests
import json
import logging
import os
from decimal import Decimal, InvalidOperation
# No longer need to import app or main_app here

logging.basicConfig(level=logging.INFO)

class LLMIntegration:
    def __init__(self, ollama_url, model_name, menu_collection, timeout=60, temperature=0.5): # Added menu_collection
        self.ollama_url = ollama_url
        self.model_name = model_name
        self.menu_collection = menu_collection # Store it
        self.timeout = timeout
        self.temperature = temperature
        logging.info(f"LLMIntegration inicializado para o modelo '{self.model_name}' em {self.ollama_url} com timeout={self.timeout}, temp={self.temperature}")

    def _get_menu_string_from_db(self):
        """
        Carrega o cardápio da coleção MongoDB e formata como string.
        Returns:
            str: String formatada do cardápio ou mensagem de erro/indisponibilidade.
        """
        if self.menu_collection is None: # MODIFIED HERE
            logging.error("LLMIntegration: self.menu_collection não está disponível.")
            return "Desculpe, o cardápio está temporariamente indisponível."
        
        try:
            menu_list_from_db = list(self.menu_collection.find({})) # Use self.menu_collection
            if not menu_list_from_db:
                return "No momento não temos itens cadastrados no cardápio."

            menu_items_formatted = []
            for item in menu_list_from_db:
                try:
                    name = item.get("name", "Item sem nome")
                    # Ensure price is treated as a string before Decimal conversion if it's float from DB
                    price_str = str(item.get("price", "0"))
                    price = Decimal(price_str) 
                    menu_items_formatted.append(f"- {name} (R$ {price:.2f})")
                except (InvalidOperation, ValueError, TypeError) as e:
                    logging.warning(f"LLMIntegration: Ignorando item com preço inválido do DB: {item}. Erro: {e}")
            
            if not menu_items_formatted:
                 return "No momento não temos itens válidos cadastrados no cardápio."
            return "\n".join(menu_items_formatted)
        except Exception as e: # Catch generic pymongo errors if any other than OperationFailure
            logging.exception(f"LLMIntegration: Erro ao carregar cardápio do MongoDB via self.menu_collection: {e}")
            return "Desculpe, ocorreu um erro ao tentar carregar o cardápio."

    def _build_base_context(self):
        """Constrói o prompt base com instruções e o menu atualizado do DB."""
        menu_string = self._get_menu_string_from_db()

        if menu_string is None:
            logging.error("Falha ao carregar o menu. Construindo prompt de erro para o LLM.")
            # Prompt de erro com instruções em inglês, mas exigindo resposta em português
            instructions = """You are a virtual assistant for Poliedro Restaurant.
ATTENTION: The menu could not be loaded due to an internal error.
Your task is to politely inform the user that the menu is currently unavailable and you cannot take orders.
Respond ONLY in Brazilian Portuguese. Example: "Desculpe, o cardápio está indisponível no momento e não consigo anotar pedidos. Por favor, tente novamente mais tarde."
DO NOT ask what the user wants. DO NOT mention error details.
Assistente:"""
            return instructions

        # Prompt completo com instruções em inglês, mas exigindo resposta em português
        instructions = f"""You are a friendly and efficient virtual assistant for Poliedro Restaurant. Your goal is to take customer orders based on the available menu. Be clear, direct, and polite. Your final response MUST be in Brazilian Portuguese. Generate only the response for 'Assistente:'. DO NOT reproduce the examples below.

**Current Menu (Cardápio Atual):**
{menu_string}

**Additional Instructions:**
- Respond naturally and grammatically correct in Brazilian Portuguese.
- **Confirmation Format:** When the customer adds items, confirm ONLY using the following exact format: Start with "Entendido. Você pediu:", followed by the bulleted list (format "Nx Item Name"), and end with "Correto?". Do NOT add any other conversational text before or after this specific confirmation structure.
- If the customer asks for something not on the menu, politely inform them that the item "não está disponível hoje".
- If the menu is unavailable (indicated by "Cardápio indisponível", "Erro ao carregar", etc.), state this clearly and do not ask what the user wants to order.
- Do not chat about other topics. Focus only on taking the order or providing information about the menu.
- Keep your answers concise.
- **Finalizing the Order:** When the user confirms the order is complete (e.g., says 'sim', 'correto', 'só isso', 'finalizar' AFTER you asked 'Correto?'), you MUST respond EXACTLY with the phrase: "Ótimo! Seu pedido foi anotado e enviado para a cozinha!". The backend will handle the details and total calculation. Do NOT list items or total here.

--- EXAMPLES BELOW - DO NOT REPRODUCE (Exemplos em Português) ---

**Exemplos de Interação:**

Cliente: Olá, bom dia! Estou com fome.
Assistente: Olá! Bem-vindo ao Restaurante Poliedro. Gostaria de ver o cardápio ou fazer um pedido?

Cliente: o que tem hoje?
Assistente: Claro! Nosso cardápio hoje é:\n{menu_string}\nO que você gostaria de pedir?

Cliente: tem pizza?
Assistente: Desculpe, não temos pizza em nosso cardápio hoje. Gostaria de pedir algum dos itens disponíveis?

Cliente: quero um hamburguer e uma batata frita
Assistente: Entendido. Você pediu:
- 1x Hambúrguer Clássico
- 1x Batata Frita (Média)
Correto?

Cliente: sim
Assistente: Ótimo! Seu pedido foi anotado e enviado para a cozinha!

Cliente: quero um refri e dois teste 3
Assistente: Entendido. Você pediu:
- 1x Refrigerante Lata
- 2x teste 3
Correto?

Cliente: é isso mesmo
Assistente: Ótimo! Seu pedido foi anotado e enviado para a cozinha!

--- END OF EXAMPLES ---
"""
        return instructions

    def generate_response(self, user_input, conversation_history=None):
        """
        Gera uma resposta da API Ollama, construindo o contexto atualizado
        com o histórico da conversa a cada chamada.
        """
        current_base_context = self._build_base_context()
        if "ATTENTION: The menu could not be loaded" in current_base_context:
             logging.warning("Usando prompt de erro pois o menu não foi carregado.")
             full_prompt = current_base_context
        else:
            history_string = ""
            if conversation_history:
                # Pega as últimas N interações (ex: 6 turnos = 3 pares user/assistant)
                recent_history = conversation_history[-6:]
                for entry in recent_history:
                    role = "Cliente" if entry.get("role") == "user" else "Assistente"
                    history_string += f"{role}: {entry.get('content', '')}\n"

            full_prompt = f"{current_base_context}\n\n{history_string}Cliente: {user_input}\nAssistente:"

        logging.debug(f"Prompt enviado para LLM (generate_response):\n{full_prompt}")

        payload = {
            "model": self.model_name,
            "prompt": full_prompt,
            "stream": False,
            "options": {
                "temperature": self.temperature,
                "stop": ["Cliente:", "\nCliente:", "\n\nCliente:"]
            }
        }
        headers = {'Content-Type': 'application/json'}

        try:
            response = requests.post(self.ollama_url, headers=headers, data=json.dumps(payload), timeout=self.timeout)
            response.raise_for_status()
            response_data = response.json()

            generated_text = response_data.get('response', '').strip()
            for stop_token in payload.get("options", {}).get("stop", []):
                if generated_text.endswith(stop_token):
                    generated_text = generated_text[:-len(stop_token)].strip()

            logging.debug(f"Resposta recebida do LLM (generate_response): {generated_text}")
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

    def check_confirmation_intent(self, user_input, previous_question):
        """
        Verifica se a entrada do usuário indica uma confirmação positiva para a pergunta anterior.
        Retorna 'sim' ou 'não'.
        """
        if not previous_question.strip().endswith("Correto?"):
             logging.warning("check_confirmation_intent called without a standard confirmation question.")

        # Prompt específico para verificar a intenção (em inglês, com exemplos)
        intent_prompt = f"""Analyze the customer's response in the context of the assistant's question.
The assistant asked the customer: "{previous_question}"
Customer's Response: "{user_input}"

Does the customer's response indicate a positive confirmation (agreement, yes, correct, proceed, finalize, etc.)?
Answer ONLY 'yes' or 'no'.

Examples:
Customer's Response: "sim" -> yes
Customer's Response: "é isso mesmo" -> yes
Customer's Response: "correto" -> yes
Customer's Response: "fechou" -> yes
Customer's Response: "pode fechar" -> yes
Customer's Response: "manda ver" -> yes
Customer's Response: "não, quero mudar" -> no
Customer's Response: "espera, adiciona mais uma coisa" -> no
Customer's Response: "qual o valor?" -> no

Based on the Customer's Response "{user_input}", is the intent a positive confirmation? Answer 'yes' or 'no':"""

        logging.info(f"Checking confirmation intent for: '{user_input}'")

        payload = {
            "model": self.model_name,
            "prompt": intent_prompt,
            "stream": False,
            "options": {
                "temperature": 0.1,
            }
        }
        headers = {'Content-Type': 'application/json'}

        try:
            # Usar timeout menor para verificação de intenção
            response = requests.post(self.ollama_url, headers=headers, data=json.dumps(payload), timeout=max(10, self.timeout / 2))
            response.raise_for_status()
            response_data = response.json()

            raw_intent_result = response_data.get('response', '').strip().lower()
            intent_result = ""
            if raw_intent_result.startswith("yes"):
                intent_result = "yes"
            elif raw_intent_result.startswith("no"):
                 intent_result = "no"

            if intent_result == 'yes' or intent_result == 'no':
                logging.info(f"Intent detected: '{intent_result}' (Raw: '{raw_intent_result}')")
                return 'sim' if intent_result == 'yes' else 'não'
            else:
                logging.warning(f"Unexpected response from LLM for intent check: '{raw_intent_result}'. Treating as 'no'.")
                return "não"

        except requests.exceptions.Timeout:
            logging.error(f"Timeout ao verificar intenção de confirmação com Ollama.")
            return "não" # Retorna 'não' em caso de timeout para segurança
        except requests.exceptions.RequestException as e:
            logging.exception(f"Erro de rede/HTTP ao verificar intenção de confirmação: {e}")
            return "não" # Retorna 'não' em caso de erro de rede
        except json.JSONDecodeError:
             logging.exception(f"Erro ao decodificar JSON da verificação de intenção: {response.text}")
             return "não" # Retorna 'não' em caso de erro de JSON
        except Exception as e:
            logging.exception("Erro inesperado ao verificar intenção de confirmação.")
            return "não" # Retorna 'não' em caso de erro inesperado