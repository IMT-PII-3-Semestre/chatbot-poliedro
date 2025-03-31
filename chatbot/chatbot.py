import os
import json
from flask import Flask, request, jsonify, render_template

app = Flask(__name__)

# Variáveis globais para rastrear o estado do pedido
pedido_em_andamento = False
pedidos = []  # Lista para armazenar os códigos dos itens pedidos
aguardando_nome = False  # Variável para rastrear se o chatbot está aguardando o nome do cliente
nome_cliente = ""  # Variável para armazenar o nome do cliente

# Carrega o cardápio do arquivo JSON
menu_path = os.path.join(os.path.dirname(__file__), "menu.json")  # Corrigido o caminho
with open(menu_path, "r", encoding="utf-8") as file:  # Certifique-se de usar UTF-8
    cardapio = json.load(file)

@app.route("/")
def home():
    return render_template("index.html")

@app.route("/chat", methods=["POST"])
def chat():
    global pedido_em_andamento, pedidos, aguardando_nome, nome_cliente
    user_message = request.json.get("message")
    if not user_message:
        return jsonify({"error": "Mensagem não fornecida"}), 400

    # Lógica para opções do menu
    if aguardando_nome:
        nome_cliente = user_message

        # Agrupa os itens iguais e calcula os valores
        itens_agrupados = {}
        for item in pedidos:
            if item in itens_agrupados:
                itens_agrupados[item]["quantidade"] += 1
                itens_agrupados[item]["total"] += cardapio[item]["preco"]
            else:
                itens_agrupados[item] = {
                    "nome": cardapio[item]["nome"],
                    "quantidade": 1,
                    "total": cardapio[item]["preco"]
                }

        # Gera a mensagem com os itens agrupados
        itens_pedidos = [
            f"{item['quantidade']}x {item['nome']} - R${item['total']:.2f}"
            for item in itens_agrupados.values()
        ]
        total = sum(item["total"] for item in itens_agrupados.values())
        response_message = f"Obrigado, {nome_cliente}! Pedido finalizado! Aqui estão os itens que você pediu:<br>{'<br>'.join(itens_pedidos)}<br>Valor total: R${total:.2f}<br>Volte sempre!"
        
        # Limpa os estados
        pedidos.clear()
        aguardando_nome = False
        pedido_em_andamento = False
    elif pedido_em_andamento and user_message == "0":
        if pedidos:
            response_message = "Por favor, insira seu nome para finalizar o pedido."
            aguardando_nome = True
        else:
            response_message = "Você não adicionou nenhum item ao pedido. Obrigado por usar o Chatbot Poliedro!"
            pedido_em_andamento = False
    elif user_message == "1" and not pedido_em_andamento:
        menu_items = [f"{key}. {item['nome']} - R${item['preco']:.2f}" for key, item in cardapio.items()]
        response_message = "Aqui está o cardápio:<br>" + "<br>".join(menu_items) + "<br>Digite o número do item que deseja pedir ou pressione 0 para finalizar o pedido."
        pedido_em_andamento = True
    elif user_message == "2" and not pedido_em_andamento:
        response_message = "Por favor, pressione 1 para visualizar o cardápio antes de fazer um pedido."
    elif pedido_em_andamento and user_message in cardapio.keys():
        pedidos.append(user_message)
        response_message = f"Você adicionou um {cardapio[user_message]['nome']} ao pedido. Digite outro número para adicionar mais itens ou pressione 0 para finalizar."
    elif user_message == "3" and not pedido_em_andamento:
        response_message = "Obrigado por usar o Chatbot Poliedro! Até logo."
    else:
        response_message = "Opção inválida. Por favor, pressione 1 para o cardápio, 2 para fazer um pedido, ou 3 para sair."

    return jsonify({"response": response_message})

if __name__ == "__main__":
    app.run(port=8000, debug=True)