document.addEventListener('DOMContentLoaded', () => {
    const chatBox = document.getElementById('chat-box');
    const userInput = document.getElementById('user-input');
    const sendButton = document.getElementById('send-button');

    // --- Chaves de Armazenamento ---
    const KDS_STORAGE_KEY = 'pedidosCozinhaPendentes';

    // --- Manter Funções Auxiliares ---
    function generateOrderId() { // Função para gerar ID do pedido
        const now = new Date();
        const timePart = now.toTimeString().slice(0, 8).replace(/:/g, '');
        const randomPart = Math.floor(100 + Math.random() * 900);
        return `${timePart}-${randomPart}`;
    }

    function saveOrderToKitchen(order) { // Função para salvar pedido para a cozinha
        let pendingOrders = JSON.parse(localStorage.getItem(KDS_STORAGE_KEY) || '[]');
        pendingOrders.push(order);
        localStorage.setItem(KDS_STORAGE_KEY, JSON.stringify(pendingOrders));
        console.log("Pedido salvo para cozinha:", order);
    }

    // --- Manter Funções da Interface do Chat ---
    function addMessage(text, sender, isHTML = false) { // Função para adicionar mensagem ao chat
        const messageWrapper = document.createElement('div');
        messageWrapper.classList.add('message-wrapper', sender);

        const avatar = document.createElement('div');
        avatar.classList.add('avatar');
        if (sender === 'bot') {
            avatar.innerHTML = '<i class="fas fa-robot"></i>';
        } else {
            avatar.textContent = 'U'; // Assumindo 'U' para Usuário
        }

        const messageContent = document.createElement('div');
        messageContent.classList.add('message-content');

        const messageElement = document.createElement('div');
        messageElement.classList.add('message');

        if (sender === 'bot' && !isHTML) {
            // Se for mensagem do bot e não for HTML explícito,
            // substitui \n por <br> para renderizar quebras de linha
            messageElement.innerHTML = text.replace(/\n/g, '<br>');
        } else if (isHTML) {
            // Se for HTML explícito (usado raramente, talvez para botões)
            messageElement.innerHTML = text;
        } else {
            // Para mensagens do usuário ou se não for bot, usa textContent
            messageElement.textContent = text;
        }

        messageContent.appendChild(messageElement);

        if (sender === 'bot') {
            messageWrapper.appendChild(avatar);
            messageWrapper.appendChild(messageContent);
        } else {
            messageWrapper.appendChild(messageContent);
            messageWrapper.appendChild(avatar);
        }

        chatBox.appendChild(messageWrapper);
        scrollToBottom();
    }

    let typingIndicator = null;
    function showTypingIndicator() { // Função para mostrar indicador de "digitando"
        if (!typingIndicator) {
            typingIndicator = document.createElement('div');
            typingIndicator.classList.add('message-wrapper', 'bot', 'typing-indicator');
            typingIndicator.innerHTML = `
                <div class="avatar"><i class="fas fa-robot"></i></div>
                <div class="message-content">
                    <div class="message">
                        <span></span><span></span><span></span>
                    </div>
                </div>
            `;
            chatBox.appendChild(typingIndicator);
            scrollToBottom();
        }
    }

    function hideTypingIndicator() { // Função para esconder indicador de "digitando"
        if (typingIndicator) {
            typingIndicator.remove();
            typingIndicator = null;
        }
    }

    function scrollToBottom() { // Função para rolar o chat para baixo
        chatBox.scrollTop = chatBox.scrollHeight;
    }

    // --- Função para Chamar o Backend Flask ---
    async function callChatAPI(userMessage) {
        const apiUrl = 'http://localhost:5000/chat'; // URL padrão da API

        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ message: userMessage }), // Envia a mensagem do usuário
            });

            hideTypingIndicator(); // Esconde o indicador após receber a resposta ou erro

            if (!response.ok) {
                console.error('Erro na API:', response.status, response.statusText);
                const errorText = await response.text();
                addMessage(`😕 Oops! Algo deu errado no servidor (${response.status}). Detalhes: ${errorText}`, 'bot');
                return;
            }

            const data = await response.json();

            if (data && data.response) {
                addMessage(data.response, 'bot'); // Adiciona a resposta do bot ao chat
            } else {
                console.error('Formato de resposta inválido da API:', data);
                addMessage("😕 Desculpe, recebi uma resposta inesperada do servidor.", 'bot');
            }

        } catch (error) {
            hideTypingIndicator(); // Esconde o indicador em caso de erro de rede
            console.error('Erro de Fetch:', error);
            // Mensagem de erro de rede genérica
            addMessage("🔌 Erro de Rede: Não foi possível conectar ao servidor do chat. Ele está rodando?", 'bot');
        }
    }

    // --- Atualizar handleSend ---
    function handleSend() { // Função para lidar com o envio de mensagem pelo usuário
        const userText = userInput.value.trim();
        if (userText) {
            addMessage(userText, 'user'); // Adiciona a mensagem do usuário ao chat
            userInput.value = ''; // Limpa o campo de entrada
            showTypingIndicator(); // Mostra que o bot está "digitando"
            callChatAPI(userText); // Chama a API com a mensagem do usuário
        }
        userInput.focus(); // Mantém o foco no campo de entrada
    }

    // --- Event Listeners (Ouvintes de Eventos) ---
    sendButton.addEventListener('click', handleSend); // Ouvinte para clique no botão Enviar
    userInput.addEventListener('keypress', (event) => { // Ouvinte para tecla pressionada no campo de entrada
        if (event.key === 'Enter') { // Se a tecla for Enter
            handleSend(); // Envia a mensagem
        }
    });

    // --- Atualizar startChat ---
    function startChat() { // Função para iniciar o chat
        showTypingIndicator(); // Mostra indicador de "digitando" inicialmente
        setTimeout(() => { // Adiciona um pequeno atraso para efeito
            hideTypingIndicator();
            // Mensagens iniciais do bot
            addMessage("Olá! Sou o assistente virtual do Restaurante Poliedro. 👋", 'bot');
            addMessage("Como posso ajudar você hoje?", 'bot');
            userInput.focus(); // Coloca o foco no campo de entrada
        }, 1200); // Atraso de 1.2 segundos
    }

    // Inicializa o chat quando a página carrega
    startChat();
});