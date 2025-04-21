# Python Flask LLM Chatbot Backend

Este diretório contém o backend da aplicação Chatbot Poliedro, implementado em Python utilizando o microframework Flask. O backend é responsável por receber as mensagens do usuário via API, processá-las utilizando um Modelo de Linguagem Grande (LLM) local através do Ollama, e retornar a resposta gerada.

## Estrutura do Diretório

```
python-flask-llm-chatbot/
├── src/                   # Código fonte do backend
│   ├── __init__.py        # Inicializador do pacote src
│   ├── app.py             # Aplicação Flask principal (servidor API)
│   ├── chatbot/           # Módulo de lógica do chatbot
│   │   ├── __init__.py    # Inicializador do pacote chatbot
│   │   └── handler.py     # Classe para manipulação das requisições de chat
│   └── llm/               # Módulo de integração com o LLM
│       ├── __init__.py    # Inicializador do pacote llm
│       └── integration.py # Classe para interação com a API Ollama
├── requirements.txt       # Dependências Python do projeto
└── README.md              # Documentação do componente backend
```

## Instruções de Configuração

Pré-requisitos:
*   Python 3.x instalado.
*   Ollama instalado e em execução ([https://ollama.com/](https://ollama.com/)).

Passos:

1.  **Navegue até este diretório:**
    ```bash
    cd chatbot/python-flask-llm-chatbot
    ```

2.  **Crie um ambiente virtual:**
    ```bash
    python -m venv venv
    ```

3.  **Ative o ambiente virtual:**
    *   Windows:
        ```bash
        venv\Scripts\activate
        ```
    *   macOS/Linux:
        ```bash
        source venv/bin/activate
        ```

4.  **Instale as dependências Python:**
    ```bash
    pip install -r requirements.txt
    ```

5.  **Baixe o modelo LLM necessário via Ollama:**
    ```bash
    ollama pull deepseek-r1
    ```
    *(O modelo padrão é `deepseek-r1`, configurado em `src/app.py`. Certifique-se que o Ollama está acessível, geralmente em `http://localhost:11434`)*

## Execução

1.  **Inicie o servidor Flask:**
    Certifique-se de que o ambiente virtual está ativado.
    ```bash
    python src/app.py
    ```
    O servidor será iniciado, por padrão, em `http://0.0.0.0:5000`.

2.  **Interação:**
    O backend expõe um endpoint `/chat` (POST) que espera um JSON com a chave `message` contendo a entrada do usuário. A interface frontend ([`chatbot/index.html`](../index.html)) está configurada para utilizar este endpoint.

## Funcionalidades Principais

*   API RESTful para interação com o chatbot (`/chat`).
*   Integração com LLMs locais via Ollama.
*   Processamento de entrada de usuário e geração de resposta.
*   Estrutura modular para extensibilidade.