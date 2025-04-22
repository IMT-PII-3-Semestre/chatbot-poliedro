# </div><p align="center">🤖 Chatbot Poliedro 🤖</p>

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

### Banco de Dados (Planejado)

-   **MongoDB**: Previsto para armazenamento persistente de dados (atualmente não implementado).

---

## Configuração e Execução

### Pré-requisitos

-   Git ([https://git-scm.com/](https://git-scm.com/))
-   Python 3 ([https://www.python.org/](https://www.python.org/))
-   Ollama ([https://ollama.com/](https://ollama.com/))

### Passos

1.  **Clone o repositório:**
    ```bash
    git clone <https://github.com/IMT-PII-3-Semestre/chatbot-poliedro>
    cd chatbot-poliedro
    ```

2.  **Configure o Backend:**
    *   Navegue até o diretório do backend:
        ```bash
        cd chatbot/python-flask-llm-chatbot
        ```
    *   Crie e ative um ambiente virtual:
        ```bash
        # Criar (apenas uma vez)
        python -m venv venv
        # Ativar (Windows)
        venv\Scripts\activate
        # Ativar (macOS/Linux)
        source venv/bin/activate
        ```
    *   Instale as dependências Python:
        ```bash
        pip install -r requirements.txt
        ```
    *   Baixe o modelo LLM via Ollama:
        ```bash
        ollama pull mistral
        ```
        *(O modelo padrão é `mistral`, configurado em `src/app.py`. O backend espera que o Ollama esteja acessível em `http://localhost:11434`)*

3.  **Execute o Backend:**
    *   Ainda no diretório `chatbot/python-flask-llm-chatbot` e com o ambiente virtual ativado:
        ```bash
        python src/app.py
        ```
    *   O servidor Flask iniciará (geralmente em `http://localhost:5000`).

4.  **Acesse o Frontend:**
    *   Abra o arquivo [`chatbot/index.html`](chatbot/index.html) diretamente no seu navegador. Ele se conectará automaticamente ao backend em execução.
    *   O painel KDS(Kitchen Display System) pode ser acessado abrindo [`chatbot/kds.html`](chatbot/kds.html).

---

## Agradecimentos

Este projeto foi desenvolvido como parte das atividades acadêmicas do **Instituto Mauá de Tecnologia**, visando uma aplicação prática no ambiente do **Sistema de Ensino Poliedro**.

| **Instituição de Ensino**                                    | **Instituição Parceira**                                      |
| :----------------------------------------------------------: | :-----------------------------------------------------------------------: |
| <img src="images/logo-IMT.png" width="150" alt="Logo IMT"> | <img src="images/logo-poliedro-se.png" width="150" alt="Logo Poliedro SE"> |