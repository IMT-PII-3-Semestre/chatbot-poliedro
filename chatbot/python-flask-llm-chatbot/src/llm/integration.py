import requests
import json
import logging
import os
from decimal import Decimal, InvalidOperation

# Configuração básica de logging (pode ser ajustada no app.py)
logging.basicConfig(level=logging.INFO)

class LLMIntegration:
    def __init__(self, ollama_url, model_name, timeout=60, temperature=0.5):
        self.ollama_url = ollama_url
        self.model_name = model_name
        self.timeout = timeout
        self.temperature = temperature
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
            return None

        try:
            with open(menu_path, 'r', encoding='utf-8') as f:
                menu_data = json.load(f)

            if not isinstance(menu_data, list):
                logging.error(f"Formato inválido no menu.json: esperado uma lista, encontrado {type(menu_data)}.")
                return None

            menu_items_formatted = []
            for item in menu_data:
                if isinstance(item, dict) and 'name' in item and 'price' in item:
                    try:
                        price = Decimal(str(item['price']))
                        if price >= 0: # Garante que o preço não seja negativo
                            menu_items_formatted.append(f"- {item['name']} (R$ {price:.2f})")
                        else:
                            logging.warning(f"Ignorando item com preço negativo no menu: {item}")
                    except (InvalidOperation, ValueError, TypeError):
                        logging.warning(f"Ignorando item com preço inválido no menu: {item}")
                else:
                    logging.warning(f"Ignorando item mal formatado no menu: {item}")

            if not menu_items_formatted:
                logging.warning("Nenhum item válido encontrado no cardápio após o parse.")
                return None

            return "\n".join(menu_items_formatted)

        except json.JSONDecodeError:
            logging.exception(f"Erro ao decodificar o arquivo menu.json em {menu_path}")
            return None
        except Exception as e:
            logging.exception(f"Erro inesperado ao carregar menu.json: {e}")
            return None

    def _build_base_context(self):
        """Constrói o prompt base com instruções, menu atualizado e exemplos,
           ou um prompt de erro se o menu não puder ser carregado."""
        menu_string = self._load_menu_from_json()

        # Verifica se o carregamento do menu falhou
        if menu_string is None:
            logging.error("Falha ao carregar o menu. Construindo prompt de erro para o LLM.")
            # Prompt mínimo informando o LLM sobre o problema
            instructions = """Você é um assistente virtual para o Restaurante Poliedro.
ATENÇÃO: O cardápio não pôde ser carregado devido a um erro interno.
Sua tarefa é informar educadamente ao usuário que o cardápio está indisponível no momento e você não pode anotar pedidos.
Responda APENAS em Português do Brasil. Exemplo: "Desculpe, o cardápio está indisponível no momento e não consigo anotar pedidos. Por favor, tente novamente mais tarde."
NÃO pergunte o que o usuário deseja. NÃO mencione detalhes do erro.
Assistente:"""
            return instructions

        # Se menu_string não for None, o menu foi carregado com sucesso. Construir prompt completo:
        # logging.info("Menu carregado com sucesso. Construindo prompt completo para o LLM.") # Log de debug removido
        instructions = f"""Você é um assistente virtual amigável e eficiente para o Restaurante Poliedro. Seu objetivo é anotar pedidos dos clientes com base no cardápio disponível. Seja claro, direto e educado. Sua resposta final DEVE ser em Português do Brasil. Gere apenas a resposta para o 'Assistente:'. NÃO reproduza os exemplos abaixo.

**Cardápio Atual:**
{menu_string}

**Instruções Adicionais:**
- Responda de forma natural e gramaticalmente correta em Português do Brasil.
- Quando o cliente adicionar itens, confirme repetindo os itens como uma lista com marcadores e pergunte se está correto ("Correto?"). Use o formato "Nx Nome do Item" para cada item na lista. Comece a confirmação com "Entendido. Você pediu:" seguido pela lista em novas linhas.
- Se o cliente pedir algo que não está no cardápio, informe educadamente que o item "não está disponível hoje".
- Se o cardápio estiver indisponível (indicado por "Cardápio indisponível", "Erro ao carregar", etc.), afirme isso claramente e não pergunte o que o usuário deseja pedir.
- Não converse sobre outros tópicos. Foque apenas em anotar o pedido ou fornecer informações sobre o cardápio.
- Mantenha suas respostas concisas.
- **Finalizando o Pedido:** Quando o usuário confirmar que o pedido está completo (ex: disser 'sim', 'correto', 'só isso', 'finalizar' DEPOIS que você perguntou 'Correto?'), você DEVE responder EXATAMENTE neste formato: "Ótimo! Pedido anotado: [Lista de itens confirmados, CADA um prefixado com quantidade como '1x Nome do Item', separados por vírgula e espaço]. Total: R$ XX,XX. Seu pedido foi enviado para a cozinha!". Calcule XX,XX com base nos preços do cardápio para os itens confirmados. Exemplo: "Ótimo! Pedido anotado: 1x Hambúrguer Clássico, 1x Refrigerante Lata. Total: R$ 20,50. Seu pedido foi enviado para a cozinha!"

--- EXEMPLOS ABAIXO - NÃO REPRODUZA ---

**Exemplos de Interação:**

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
Assistente: Ótimo! Pedido anotado: 1x Hambúrguer Clássico, 1x Batata Frita (Média). Total: R$ 23,50. Seu pedido foi enviado para a cozinha!

Cliente: quero um refri e dois teste 3
Assistente: Entendido. Você pediu:
- 1x Refrigerante Lata
- 2x teste 3
Correto?

Cliente: sim, só isso
Assistente: Ótimo! Pedido anotado: 1x Refrigerante Lata, 2x teste 3. Total: R$ 11,00. Seu pedido foi enviado para a cozinha!

--- FIM DOS EXEMPLOS ---
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
        # logging.info(f"Enviando prompt para Ollama (modelo: {self.model_name}, início):\n{full_prompt[:500]}...") # Log de debug removido

        payload = {
            "model": self.model_name,
            "prompt": full_prompt,
            "stream": False,
            "options": {
                "temperature": self.temperature,
                "stop": ["Cliente:", "\nCliente:", "\n\nCliente:"] # Tokens para parar a geração
            }
        }
        headers = {'Content-Type': 'application/json'}

        try:
            response = requests.post(self.ollama_url, headers=headers, data=json.dumps(payload), timeout=self.timeout)
            response.raise_for_status() # Lança exceção para erros HTTP (4xx ou 5xx)
            response_data = response.json()

            # Limpa a resposta removendo potenciais tokens de parada no final
            generated_text = response_data.get('response', '').strip()
            for stop_token in payload.get("options", {}).get("stop", []):
                if generated_text.endswith(stop_token):
                    generated_text = generated_text[:-len(stop_token)].strip()

            # logging.info(f"Resposta recebida do Ollama: '{generated_text}'") # Log de debug removido
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

        Args:
            user_input (str): A resposta do usuário.
            previous_question (str): A pergunta de confirmação feita pelo bot (ex: "Correto?").

        Returns:
            str: 'sim' ou 'não' (em minúsculas) se a intenção for detectada com sucesso.
                 Retorna uma string vazia "" em caso de erro ou resposta ambígua do LLM.
        """
        # Garante que a pergunta anterior termine com "Correto?" para o contexto do prompt
        # (Pode ajustar se o formato da sua pergunta de confirmação mudar)
        if not previous_question.strip().endswith("Correto?"):
             logging.warning("check_confirmation_intent chamado sem uma pergunta de confirmação padrão.")
             # Poderia retornar "" aqui ou tentar mesmo assim, dependendo da robustez desejada.
             # Vamos tentar mesmo assim, mas o prompt pode ser menos eficaz.

        # Prompt específico para verificar a intenção
        intent_prompt = f"""Contexto: O assistente perguntou ao cliente: "{previous_question}"
Resposta do Cliente: "{user_input}"

A resposta do cliente indica uma confirmação positiva (sim, correto, pode finalizar, etc.)?
Responda APENAS 'sim' ou 'não'."""

        logging.info(f"Verificando intenção de confirmação para: '{user_input}'")

        payload = {
            "model": self.model_name,
            "prompt": intent_prompt,
            "stream": False,
            "options": {
                "temperature": 0.1, # Temperatura baixa para resposta direta
                # Não precisa de 'stop' aqui, pois esperamos resposta curta
            }
        }
        headers = {'Content-Type': 'application/json'}

        try:
            response = requests.post(self.ollama_url, headers=headers, data=json.dumps(payload), timeout=self.timeout / 2) # Timeout menor para esta chamada rápida
            response.raise_for_status()
            response_data = response.json()
            intent_result = response_data.get('response', '').strip().lower()

            # Valida se a resposta é estritamente 'sim' ou 'não'
            if intent_result == 'sim' or intent_result == 'não':
                logging.info(f"Intenção detectada: '{intent_result}'")
                return intent_result
            else:
                logging.warning(f"Resposta inesperada do LLM para verificação de intenção: '{intent_result}'. Tratando como 'não'.")
                return "não" # Ou retornar "" para indicar incerteza

        except requests.exceptions.Timeout:
            logging.error(f"Timeout ao verificar intenção de confirmação com Ollama.")
            return "" # Retorna vazio em caso de erro
        except requests.exceptions.RequestException as e:
            logging.exception(f"Erro de rede/HTTP ao verificar intenção de confirmação: {e}")
            return "" # Retorna vazio em caso de erro
        except json.JSONDecodeError:
             logging.exception(f"Erro ao decodificar JSON da verificação de intenção: {response.text}")
             return "" # Retorna vazio em caso de erro
        except Exception as e:
            logging.exception("Erro inesperado ao verificar intenção de confirmação.")
            return "" # Retorna vazio em caso de erro