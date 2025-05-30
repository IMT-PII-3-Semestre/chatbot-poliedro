import requests
import json
import logging
from decimal import Decimal, InvalidOperation

# Configuração básica do logging para este módulo.
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(module)s - %(message)s')

class LLMIntegration:
    def __init__(self, ollama_url, model_name, menu_collection, timeout=60, temperature=0.5, max_history_turns=3):
        self.ollama_url = ollama_url
        self.model_name = model_name
        self.menu_collection = menu_collection # Coleção MongoDB para buscar o cardápio.
        self.timeout = timeout
        self.temperature = temperature
        # Número de pares de turnos (usuário/assistente) a serem mantidos no histórico para o prompt.
        self.max_history_turns = max_history_turns
        # Strings que indicam que o menu não está disponível ou houve erro ao carregá-lo.
        self.known_menu_error_prefixes = (
            "Desculpe, o cardápio está temporariamente indisponível.",
            "No momento não temos itens cadastrados no cardápio.",
            "No momento não temos itens válidos cadastrados no cardápio.",
            "Desculpe, ocorreu um erro ao tentar carregar o cardápio."
        )
        logging.info(
            f"LLMIntegration inicializado para o modelo '{self.model_name}' em {self.ollama_url} "
            f"com timeout={self.timeout}, temp={self.temperature}, max_history_turns={self.max_history_turns}"
        )

    def _get_menu_string_from_db(self):
        """
        Carrega o cardápio da coleção MongoDB e o formata como uma string.
        Retorna:
            str: String formatada do cardápio ou uma mensagem de erro/indisponibilidade.
        """
        if self.menu_collection is None:
            logging.error("LLMIntegration: self.menu_collection (coleção do cardápio) não está disponível.")
            return "Desculpe, o cardápio está temporariamente indisponível."
        
        try:
            menu_list_from_db = list(self.menu_collection.find({}))
            if not menu_list_from_db:
                return "No momento não temos itens cadastrados no cardápio."

            menu_items_formatted = []
            for item in menu_list_from_db:
                try:
                    name = item.get("name", "Item sem nome")
                    # Garante que o preço seja tratado como string antes da conversão para Decimal,
                    # especialmente se vier como float do DB.
                    price_str = str(item.get("price", "0"))
                    price = Decimal(price_str)
                    menu_items_formatted.append(f"- {name} (R$ {price:.2f})")
                except (InvalidOperation, ValueError, TypeError) as e:
                    logging.warning(f"LLMIntegration: Ignorando item com preço inválido do DB: {item}. Erro: {e}")
            
            if not menu_items_formatted: # Caso todos os itens tenham tido preço inválido.
                 return "No momento não temos itens válidos cadastrados no cardápio."
            return "\n".join(menu_items_formatted)
        except Exception as e: # Captura erros genéricos do PyMongo ou outros.
            logging.exception(f"LLMIntegration: Erro ao carregar cardápio do MongoDB via self.menu_collection: {e}")
            return "Desculpe, ocorreu um erro ao tentar carregar o cardápio."

    def _is_menu_unavailable(self, menu_string):
        """Verifica se a string do menu indica que ele não está disponível."""
        return any(menu_string.startswith(prefix) for prefix in self.known_menu_error_prefixes)

    def _build_base_context(self):
        """
        Constrói o prompt base para o LLM.
        Retorna uma tupla: (string_do_prompt_base, booleano_indicando_se_eh_prompt_de_erro).
        """
        menu_string = self._get_menu_string_from_db()

        if self._is_menu_unavailable(menu_string):
            logging.warning("Falha ao carregar o menu ou menu vazio. Construindo prompt de erro para o LLM.")
            # Prompt de erro específico quando o menu não está disponível.
            # Instruções para o LLM em inglês por ser a principal linguagem que são treinadas, mas exigindo resposta em português.
            base_prompt = """You are a virtual assistant for Poliedro Restaurant.
ATTENTION: The menu could not be loaded or is empty.
Your task is to politely inform the user that the menu is currently unavailable and you cannot take orders.
Respond ONLY in Brazilian Portuguese. Example: "Desculpe, o cardápio está indisponível no momento e não consigo anotar pedidos. Por favor, tente novamente mais tarde."
DO NOT ask what the user wants. DO NOT mention error details.
Assistente:"""
            return base_prompt, True # True indica que é um prompt de erro

        # Prompt principal com instruções para o LLM em inglês.
        # O cardápio e os exemplos de interação são em português.
        # A resposta final do LLM DEVE ser em português do Brasil.
        base_prompt = f"""You are a friendly and efficient virtual assistant for Poliedro Restaurant. Your goal is to take customer orders based on the available menu. Be clear, direct, and polite. Your final response MUST be in Brazilian Portuguese. Generate only the response for 'Assistente:'. DO NOT reproduce the examples below.

**Current Menu (Cardápio Atual):**
{menu_string}

**Additional Instructions:**
- Respond naturally and grammatically correct in Brazilian Portuguese.
- **Confirmation Format:** When the customer adds items, confirm ONLY using the following exact format: Start with "Entendido. Você pediu:", followed by the bulleted list (format "Nx Item Name"), and end with "Correto?". Do NOT add any other conversational text before or after this specific confirmation structure.
- If the customer asks for something not on the menu, politely inform them that the item "não está disponível hoje".
- Do not chat about other topics. Focus only on taking the order or providing information about the menu.
- Keep your answers concise.
- **Finalizing the Order:** When the user confirms the order is complete (e.g., says 'sim', 'correto', 'só isso', 'finalizar' AFTER you asked 'Correto?'), you MUST respond EXACTLY with the phrase: "Ótimo! Seu pedido foi anotado e enviado para a cozinha!". The backend will handle the details and total calculation. Do NOT list items or total here.

--- EXAMPLES BELOW - DO NOT REPRODUCE (Exemplos de Interação em Português) ---

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
        return base_prompt, False # False indica que não é um prompt de erro

    def generate_response(self, user_input, conversation_history=None):
        """
        Gera uma resposta da API Ollama, construindo o contexto atualizado
        com o histórico da conversa a cada chamada.
        """
        base_prompt, is_error_prompt = self._build_base_context()
        
        if is_error_prompt:
             logging.warning("Usando prompt de erro pois o menu não foi carregado ou está vazio.")
             full_prompt = base_prompt # Usa apenas o prompt de erro, sem histórico.
        else:
            history_string = ""
            if conversation_history:
                # Considera as últimas N interações (N pares de user/assistant)
                num_messages_to_keep = self.max_history_turns * 2 
                recent_history = conversation_history[-num_messages_to_keep:]
                for entry in recent_history:
                    role = "Cliente" if entry.get("role") == "user" else "Assistente"
                    history_string += f"{role}: {entry.get('content', '')}\n"

            full_prompt = f"{base_prompt}\n\n{history_string}Cliente: {user_input}\nAssistente:"

        # Loga apenas uma parte do prompt para evitar logs excessivamente longos.
        logging.debug(f"Prompt enviado para LLM (generate_response):\n{full_prompt[:1000]}...")

        payload = {
            "model": self.model_name,
            "prompt": full_prompt,
            "stream": False, # Garante que a resposta completa seja recebida de uma vez.
            "options": {
                "temperature": self.temperature,
                "stop": ["Cliente:", "\nCliente:", "\n\nCliente:"] # Tokens para interromper a geração.
            }
        }
        headers = {'Content-Type': 'application/json'}

        try:
            response = requests.post(self.ollama_url, headers=headers, data=json.dumps(payload), timeout=self.timeout)
            response.raise_for_status() # Levanta uma exceção para respostas HTTP 4xx/5xx.
            response_data = response.json()

            generated_text = response_data.get('response', '').strip()
            # Remove tokens de parada do final da resposta, se presentes.
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
            # response.text pode ser útil para depurar o que foi recebido.
            logging.exception(f"Erro ao decodificar a resposta JSON do Ollama: {response.text if 'response' in locals() else 'Resposta não disponível'}")
            return "Desculpe, recebi uma resposta inválida do serviço de chat."
        except Exception as e:
            logging.exception("Ocorreu um erro inesperado na integração com o LLM.")
            return "Desculpe, ocorreu um erro inesperado."

    def check_confirmation_intent(self, user_input, previous_question):
        """
        Verifica se a entrada do usuário indica uma confirmação positiva para a pergunta anterior do assistente.
        Usa o LLM para classificar a intenção como 'sim' ou 'não'.
        Retorna:
            str: 'sim' ou 'não'.
        """
        # Validação básica da pergunta anterior.
        if not previous_question.strip().endswith("Correto?"):
             logging.warning("check_confirmation_intent chamada sem uma pergunta de confirmação padrão terminada em 'Correto?'.")

        # Prompt específico para o LLM classificar a intenção de confirmação.
        # Instruções e exemplos em inglês para o modelo, mas a análise é sobre a resposta do usuário em português.
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

        logging.info(f"Verificando intenção de confirmação para: '{user_input}' em resposta a '{previous_question}'")

        payload = {
            "model": self.model_name,
            "prompt": intent_prompt,
            "stream": False,
            "options": {
                "temperature": 0.1, # Baixa temperatura para respostas mais determinísticas.
            }
        }
        headers = {'Content-Type': 'application/json'}

        try:
            # Timeout menor para esta chamada, pois é uma tarefa de classificação mais simples.
            # Usando max para garantir que o timeout não seja menor que 10s.
            effective_timeout = max(10, self.timeout // 2) if self.timeout else 10
            response = requests.post(self.ollama_url, headers=headers, data=json.dumps(payload), timeout=effective_timeout)
            response.raise_for_status()
            response_data = response.json()

            raw_intent_result = response_data.get('response', '').strip().lower()
            intent_result = ""
            # Verifica se a resposta do LLM começa com 'yes' ou 'no'.
            if raw_intent_result.startswith("yes"):
                intent_result = "yes"
            elif raw_intent_result.startswith("no"):
                 intent_result = "no"

            if intent_result in ['yes', 'no']:
                logging.info(f"Intenção detectada: '{intent_result}' (Resposta bruta do LLM: '{raw_intent_result}')")
                return 'sim' if intent_result == 'yes' else 'não'
            else:
                logging.warning(f"Resposta inesperada do LLM para verificação de intenção: '{raw_intent_result}'. Tratando como 'não'.")
                return "não" # Fallback para 'não' se a resposta do LLM não for clara.

        except requests.exceptions.Timeout:
            logging.error(f"Timeout ao verificar intenção de confirmação com Ollama.")
            return "não" # Retorna 'não' em caso de timeout para segurança.
        except requests.exceptions.RequestException as e:
            logging.exception(f"Erro de rede/HTTP ao verificar intenção de confirmação: {e}")
            return "não" # Retorna 'não' em caso de erro de rede.
        except json.JSONDecodeError:
             # response.text pode ser útil para depurar o que foi recebido.
             logging.exception(f"Erro ao decodificar JSON da verificação de intenção: {response.text if 'response' in locals() else 'Resposta não disponível'}")
             return "não" # Retorna 'não' em caso de erro de JSON.
        except Exception as e:
            logging.exception("Erro inesperado ao verificar intenção de confirmação.")
            return "não" # Retorna 'não' em caso de erro inesperado.
