import logging
import re
from decimal import Decimal, InvalidOperation

class ChatbotHandler:
    """
    Classe responsável por intermediar a comunicação entre a aplicação Flask
    e a integração com o LLM, além de gerenciar a lógica do chat.
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
        logging.info("ChatbotHandler inicializado.")

    def _parse_and_validate_items_from_llm_response(self, llm_response_text, menu_data):
        """
        Extrai itens da resposta do LLM (seja confirmação ou listagem)
        e os valida contra o menu.

        Args:
            llm_response_text (str): A resposta completa do LLM.
            menu_data (dict): O dicionário do cardápio carregado 
                              (formato: {lower_name: {"original_name": str, "price": Decimal}}).

        Returns:
            list: Lista de dicionários {'name': str (original case), 'quantity': int, 'price': Decimal} dos itens válidos.
        """
        validated_items = []
        
        confirmation_match = re.search(
            r'Entendido\.\s*Você\s+pediu:\s*(.*?)(?:\s*Correto\?|\s*Total:|\s*$)', 
            llm_response_text, re.IGNORECASE | re.DOTALL
        )
        
        items_string_area = ""
        if confirmation_match:
            items_string_area = confirmation_match.group(1).strip()
        else:
            logging.debug(f"Padrão de confirmação explícito não encontrado em: '{llm_response_text[:100]}...'")
            return []

        item_lines = [line.strip() for line in items_string_area.splitlines() if line.strip()]

        if not menu_data:
            logging.error("Handler._parse_and_validate: Cardápio vazio ou não carregado.")
            return []

        for line in item_lines:
            clean_line = line.lstrip('- ').strip()
            if not clean_line:
                continue

            item_match = re.match(r'^(?:(\d+)\s*[xX]\s+)?(.+?)(?:\s*\(R\$[\d,.]+\))?$', clean_line, re.IGNORECASE)
            if item_match:
                quantity_str = item_match.group(1)
                quantity = int(quantity_str) if quantity_str else 1
                parsed_name = item_match.group(2).strip()
                
                menu_item_details = menu_data.get(parsed_name.lower())

                if menu_item_details is None:
                    name_base = re.sub(r'\s*\(.*\)$', '', parsed_name).strip().lower()
                    menu_item_details = menu_data.get(name_base)
                
                if menu_item_details:
                    validated_items.append({
                        "name": menu_item_details["original_name"],
                        "quantity": quantity, 
                        "price": menu_item_details["price"]
                    })
                else:
                    logging.warning(f"Handler._parse_and_validate: Item '{parsed_name}' da resposta do LLM não encontrado no menu.")
            else:
                logging.warning(f"Handler._parse_and_validate: Não foi possível parsear linha da resposta do LLM: '{line}'")
        
        logging.debug(f"Itens validados da resposta do LLM: {validated_items}")
        return validated_items

    def update_cart_from_validated(self, current_cart, validated_items_from_llm):
        """
        Atualiza o carrinho com base nos itens validados da resposta do LLM.
        """
        updated_cart = list(current_cart) 

        for llm_item in validated_items_from_llm:
            llm_item_name_lower = llm_item['name'].lower()
            found_in_cart = False
            
            for i in range(len(updated_cart) -1, -1, -1):
                cart_item = updated_cart[i]
                if cart_item['name'].lower() == llm_item_name_lower:
                    if llm_item['quantity'] > 0:
                        cart_item['quantity'] = llm_item['quantity']
                        cart_item['price'] = llm_item['price'] 
                    else: 
                        updated_cart.pop(i)
                    found_in_cart = True
                    break 
            
            if not found_in_cart and llm_item['quantity'] > 0:
                updated_cart.append({
                    "name": llm_item['name'],
                    "quantity": llm_item['quantity'],
                    "price": llm_item['price']
                })
        return updated_cart

    def format_order_details(self, cart, menu_data, include_total=False, for_confirmation=True):
        """
        Formata os detalhes do pedido para exibição.
        """
        if not cart:
            return "Seu carrinho está vazio.", Decimal('0.00')

        details_parts = []
        total_geral = Decimal('0.00')

        for item_in_cart in cart:
            item_name_original = item_in_cart['name']
            quantity = item_in_cart.get('quantity', 1)
            price_unit = item_in_cart.get('price')

            if price_unit is not None:
                try:
                    price_unit = Decimal(str(price_unit))
                    item_total = price_unit * quantity
                    total_geral += item_total
                    if for_confirmation: 
                        details_parts.append(f"- {quantity}x {item_name_original}")
                    else: 
                        details_parts.append(f"- {quantity}x {item_name_original} (R$ {price_unit:.2f} cada) = R$ {item_total:.2f}")
                except InvalidOperation:
                    details_parts.append(f"- {quantity}x {item_name_original} (Erro no preço)")
                    logging.error(f"Erro ao converter preço para Decimal para o item '{item_name_original}' no carrinho.")
            else:
                menu_item_details = menu_data.get(item_name_original.lower())
                if menu_item_details and menu_item_details.get('price') is not None:
                    price_unit = menu_item_details['price']
                    item_total = price_unit * quantity
                    total_geral += item_total
                    if for_confirmation:
                        details_parts.append(f"- {quantity}x {item_name_original}")
                    else:
                        details_parts.append(f"- {quantity}x {item_name_original} (R$ {price_unit:.2f} cada) = R$ {item_total:.2f}")
                else:
                    details_parts.append(f"- {quantity}x {item_name_original} (Preço indisponível)")
                    logging.warning(f"Preço para '{item_name_original}' não encontrado no carrinho nem no menu_data ao formatar detalhes.")

        details_str = "\n".join(details_parts)
        if include_total:
            details_str += f"\n\nTotal: R$ {total_geral:.2f}"
        
        return details_str, total_geral

    def calculate_total(self, cart, menu_data):
        """Calcula o total do carrinho."""
        _, total = self.format_order_details(cart, menu_data, include_total=True, for_confirmation=False)
        return total

    def process_input(self, user_input, current_cart, conversation_history, last_bot_message, menu_data):
        """
        Processa a entrada do usuário, interage com o LLM, analisa a resposta
        e determina as ações a serem tomadas no carrinho e na conversa.
        """
        output = {
            "llm_response": "Desculpe, não consegui processar sua solicitação.",
            "action": "none",
            "cart_updated": list(current_cart)
        }

        try:
            llm_response_text = self.llm_integration.generate_response(user_input, conversation_history)
            output["llm_response"] = llm_response_text

            if "Você pediu:" in llm_response_text and llm_response_text.strip().endswith("Correto?"):
                logging.info("LLM gerou uma mensagem de confirmação.")
                validated_items = self._parse_and_validate_items_from_llm_response(llm_response_text, menu_data)
                
                if validated_items:
                    output["cart_updated"] = self.update_cart_from_validated(list(current_cart), validated_items)
                    output["action"] = "needs_confirmation"
                    logging.info(f"Itens para confirmação: {validated_items}. Carrinho atualizado para: {output['cart_updated']}")
                else:
                    logging.warning("LLM pediu confirmação, mas nenhum item válido foi parseado da sua resposta.")
                    output["action"] = "none"

            elif "pedido foi anotado e enviado para a cozinha" in llm_response_text:
                logging.info("LLM gerou uma mensagem de finalização de pedido.")
                output["action"] = "finalize_order_confirmed"

            elif "carrinho foi esvaziado" in llm_response_text.lower() or \
                 "itens foram removidos do seu carrinho" in llm_response_text.lower() or \
                 "seu carrinho está vazio agora" in llm_response_text.lower():
                logging.info("LLM indicou que o carrinho foi/deve ser limpo.")
                output["action"] = "clear_cart"
                output["cart_updated"] = []
            
        except Exception as e:
            logging.exception(f"Erro em ChatbotHandler.process_input: {e}")
            output["llm_response"] = "Desculpe, ocorreu um erro interno ao falar com o assistente."
            output["cart_updated"] = list(current_cart) 
        
        return output