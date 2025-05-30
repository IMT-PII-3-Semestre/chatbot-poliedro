# 🤖 Chatbot Poliedro 🤖

Bem-vindo ao repositório do **Chatbot Poliedro**, um projeto interdisciplinar desenvolvido por alunos do 3º semestre do curso de Ciências da Computação do Instituto Mauá de Tecnologia. Este sistema visa otimizar o atendimento nos restaurantes das escolas Poliedro, reduzindo filas e aprimorando a comunicação entre clientes e cozinha.

---

## Descrição do Projeto

O **Chatbot Poliedro** é um sistema de atendimento automatizado que utiliza inteligência artificial para receber e gerenciar pedidos de forma eficiente. Foi desenvolvido para tratar problemas de longas filas e atrasos no atendimento, particularmente durante períodos de alta demanda.
Para complementar, um sistema KDS (Kitchen Display System) foi integrado para que a cozinha visualize e gerencie os pedidos recebidos em tempo real.

### Objetivos do Sistema

-   Otimizar o tempo de resposta no processo de registro de pedidos.
-   Facilitar a comunicação dos pedidos para a equipe da cozinha.
-   Reduzir o tempo de espera em filas e melhorar a experiência geral de atendimento no restaurante.

---

## Equipe de Desenvolvimento

-   **Product Owner**: Thiago Arevolo De Azevedo – RA: 23.01294-3 
-   **Scrum Master**: Henrique Impastaro – RA: 24.01777-9 
-   **Desenvolvedores**:
    -   Arthur Trindade de Souza – RA: 24.00204-6  
    -   Henrique Impastaro – RA: 24.01777-9 
    -   Murilo Rodrigues – RA: 24.01780-9 
    -   Pedro Henrique de Paiva Bittencourt – RA: 24.00162-7 
    -   Thiago Arevolo De Azevedo – RA: 23.01294-3 

---

## Tecnologias Empregadas

### Frontend (Interface do Chat e Painel KDS)

-   **HTML5**: Estruturação das páginas web ([`chatbot/index.html`](chatbot/index.html), [`chatbot/kds.html`](chatbot/kds.html)).
-   **CSS3**: Estilização e layout visual ([`chatbot/style.css`](chatbot/style.css), [`chatbot/kds.css`](chatbot/kds.css)).
-   **JavaScript (ES6+)**: Interatividade do chat, manipulação do DOM, comunicação com o backend e lógica do KDS/Admin ([`chatbot/script.js`](chatbot/script.js), [`chatbot/kds.js`](chatbot/kds.js)).

### Backend (Servidor e Integração LLM)

-   **Python**: Linguagem principal para o servidor.
-   **Flask**: Microframework web para a API RESTful ([`chatbot/python-flask-llm-chatbot/src/app.py`](chatbot/python-flask-llm-chatbot/src/app.py)).
-   **Flask-CORS**: Middleware para habilitar requisições Cross-Origin Resource Sharing (CORS).
-   **Requests**: Biblioteca para realizar chamadas HTTP para a API do LLM ([`chatbot/python-flask-llm-chatbot/src/llm/integration.py`](chatbot/python-flask-llm-chatbot/src/llm/integration.py)).
-   **Ollama**: Plataforma externa para execução local de Modelos de Linguagem Grandes (LLMs).
-   **python-dotenv**: Para gerenciamento de variáveis de ambiente.
-   **pymongo**: Biblioteca Python para interagir com o MongoDB.
-   **pytz**: Para manipulação de fusos horários.

### Banco de Dados

-   **MongoDB**: Utilizado para armazenamento persistente do cardápio (menu) e dos pedidos dos clientes.

---

## Configuração e Execução

### Pré-requisitos

-   Git ([https://git-scm.com/](https://git-scm.com/))
-   Python 3.10 ou superior ([https://www.python.org/](https://www.python.org/))
-   Ollama ([https://ollama.com/](https://ollama.com/))
-   MongoDB (Instância local ou um serviço na nuvem como MongoDB Atlas - [https://www.mongodb.com/](https://www.mongodb.com/))

### Passos

1.  **Prepare o Ollama:**
    Certifique-se de que o Ollama está instalado e em execução em sua máquina. Baixe o modelo LLM que será utilizado (o padrão configurado no projeto é `mistral`, mas você pode alterá-lo no arquivo `.env`):
    ```bash
    ollama pull mistral
    ```

2.  **Clone o repositório:**
    ```bash
    git clone <https://github.com/IMT-PII-3-Semestre/chatbot-poliedro>
    cd chatbot-poliedro
    ```

3.  **Configure o Backend (Servidor Flask):**

    a.  Navegue até o diretório do backend:
    
        ```bash
        cd chatbot/python-flask-llm-chatbot
        ```
    
    b.  Crie e ative um ambiente virtual (altamente recomendado):
        ```bash
        python -m venv .venv
        ```
        No Windows:
        ```bash
        .venv\Scripts\activate
        ```
        No macOS/Linux:
        ```bash
        source .venv/bin/activate
        ```
    c.  Instale as dependências do backend:

        ```bash
        pip install -r requirements.txt
        ```

    d.  **Configure as variáveis de ambiente:**

        Na raiz do diretório `chatbot/python-flask-llm-chatbot`, você encontrará um arquivo chamado `.env`.
        **Abra este arquivo `.env` e edite-o**, substituindo os valores de placeholder (especialmente para `MONGODB_URI` e `FLASK_SECRET_KEY`) pelos seus dados reais. O arquivo já contém comentários explicando cada variável.

        **Importante:** Certifique-se de que o arquivo `.env` com suas credenciais reais **não seja** commitado no repositório se ele for público. O arquivo `.env` no repositório deve servir apenas como um template.

    e.  Execute o servidor Flask (ainda dentro de `chatbot/python-flask-llm-chatbot`):
        ```bash
        python src/app.py
        ```
        O servidor backend estará rodando, por padrão, em `http://127.0.0.1:5000`.

5.  **Acesse o Frontend (Chat e KDS):**
    a.  Para a interface do Chat, abra o arquivo `chatbot/index.html` (localizado em `caminho/para/chatbot-poliedro/chatbot/index.html`) em seu navegador.
    b.  Para o painel KDS/Admin, abra o arquivo `chatbot/kds.html` (localizado em `caminho/para/chatbot-poliedro/chatbot/kds.html`) em seu navegador.
    
---

## Agradecimentos

Este projeto foi desenvolvido como parte das atividades acadêmicas do **Instituto Mauá de Tecnologia**, visando uma aplicação prática no ambiente do **Sistema de Ensino Poliedro**.

| **Instituição de Ensino**                                    | **Instituição Parceira**                                      |
| :----------------------------------------------------------: | :-----------------------------------------------------------------------: |
| <img src="images/logo-IMT.png" width="150" alt="Logo IMT"> | <img src="images/logo-poliedro-se.png" width="150" alt="Logo Poliedro SE"> |


