document.addEventListener('DOMContentLoaded', () => {
    const chatBox = document.getElementById('chat-box');
    const userInput = document.getElementById('user-input');
    const sendButton = document.getElementById('send-button');

    // Chave para armazenar pedidos pendentes no KDS
    const KDS_STORAGE_KEY = 'pedidosCozinhaPendentes';

    // Variável para guardar a referência ao indicador de digitação
    let typingIndicatorElement = null;

    // --- Funções Auxiliares ---

    /** Gera um ID único para o pedido (simplificado) */
    function generateOrderId() {
        const now = new Date();
        // Formato HHMMSS-XXX (XXX é aleatório)
        const timePart = now.toTimeString().slice(0, 8).replace(/:/g, '');
        const randomPart = Math.floor(100 + Math.random() * 900);
        return `${timePart}-${randomPart}`;
    }

    /** Salva um pedido no localStorage para ser exibido no KDS */
    function saveOrderToKitchen(orderData) {
        if (!orderData || !orderData.id) {
            console.error("Tentativa de salvar dados de pedido inválidos:", orderData);
            return;
        }
        try {
            let pendingOrders = JSON.parse(localStorage.getItem(KDS_STORAGE_KEY) || '[]');
            // Evita duplicatas pelo ID
            if (!pendingOrders.some(o => o.id === orderData.id)) {
                pendingOrders.push(orderData);
                localStorage.setItem(KDS_STORAGE_KEY, JSON.stringify(pendingOrders));
                console.log("Pedido salvo para cozinha via localStorage:", orderData);
            } else {
                console.warn("Tentativa de salvar pedido duplicado ignorada:", orderData.id);
            }
        } catch (e) {
            console.error("Erro ao salvar pedido no localStorage:", e);
            // Considerar notificar o usuário sobre a falha?
        }
    }

    // --- Funções da Interface do Chat ---

    /** Adiciona uma mensagem à caixa de chat */
    function addMessage(text, sender) {
        const messageWrapper = document.createElement('div');
        messageWrapper.classList.add('message-wrapper', sender); // 'user' ou 'bot'

        const avatar = document.createElement('div');
        avatar.classList.add('avatar');
        avatar.innerHTML = sender === 'bot' ? '<i class="fas fa-robot"></i>' : 'U'; // 'U' para Usuário

        const messageContent = document.createElement('div');
        messageContent.classList.add('message-content');

        const messageElement = document.createElement('div');
        messageElement.classList.add('message');
        messageElement.innerHTML = sender === 'bot' ? text.replace(/\n/g, '<br>') : text;

        messageContent.appendChild(messageElement);

        // Adiciona botões de Sim/Não se for uma pergunta de confirmação do bot
        if (sender === 'bot' && text.trim().endsWith("Correto?")) {
            addConfirmationButtons(messageContent);
        }

        // Ordem diferente para usuário e bot
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

    /** Adiciona botões de Sim/Não para confirmação */
    function addConfirmationButtons(parentContainer) {
        const buttonContainer = document.createElement('div');
        buttonContainer.classList.add('chat-button-container'); // Estilo definido anteriormente ou novo

        const yesButton = document.createElement('button');
        yesButton.classList.add('chat-button');
        yesButton.textContent = 'Sim';
        yesButton.addEventListener('click', () => {
            addMessage('Sim', 'user'); // Mostra a escolha do usuário
            callChatAPI('sim');       // Envia "sim" para o backend
            removeConfirmationButtons(parentContainer);
        });

        const noButton = document.createElement('button');
        noButton.classList.add('chat-button', 'cancel'); // Estilo opcional para 'Não'
        noButton.textContent = 'Não';
        noButton.addEventListener('click', () => {
            addMessage('Não', 'user'); // Mostra a escolha do usuário
            callChatAPI('não');      // Envia "não" para o backend
            removeConfirmationButtons(parentContainer);
        });

        buttonContainer.appendChild(yesButton);
        buttonContainer.appendChild(noButton);
        parentContainer.appendChild(buttonContainer);
    }

    /** Remove os botões de confirmação após o clique */
    function removeConfirmationButtons(parentContainer) {
        const buttonContainer = parentContainer.querySelector('.chat-button-container');
        if (buttonContainer) {
            buttonContainer.remove();
        }
    }

    /** Mostra o indicador de "digitando" */
    function showLoadingIndicator() {
        // Remove qualquer indicador anterior, caso exista
        hideLoadingIndicator();

        const indicatorWrapper = document.createElement('div');
        indicatorWrapper.classList.add('message-wrapper', 'bot'); // Aparece como se fosse do bot

        const avatar = document.createElement('div');
        avatar.classList.add('avatar');
        avatar.innerHTML = '<i class="fas fa-robot"></i>';

        const messageContent = document.createElement('div');
        messageContent.classList.add('message-content');

        const indicator = document.createElement('div');
        indicator.classList.add('typing-indicator');
        indicator.innerHTML = '<span></span><span></span><span></span>'; // As três bolinhas

        messageContent.appendChild(indicator);
        indicatorWrapper.appendChild(avatar);
        indicatorWrapper.appendChild(messageContent);

        chatBox.appendChild(indicatorWrapper);
        typingIndicatorElement = indicatorWrapper; // Guarda a referência
        scrollToBottom();
    }

    /** Esconde o indicador de "digitando" */
    function hideLoadingIndicator() {
        if (typingIndicatorElement) {
            chatBox.removeChild(typingIndicatorElement);
            typingIndicatorElement = null;
        }
    }

    /** Rola a caixa de chat para a última mensagem */
    function scrollToBottom() {
        chatBox.scrollTop = chatBox.scrollHeight;
    }

    // --- Função Principal: Chamar API do Backend ---
    async function callChatAPI(userMessage) {
        const apiUrl = 'http://127.0.0.1:5000/chat'; // URL absoluta para o backend Flask

        // MOSTRA o indicador ANTES de chamar a API
        showLoadingIndicator();

        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ message: userMessage }),
                credentials: 'include' // Envia cookies (necessário para session Flask)
            });

            // ESCONDE o indicador ANTES de processar a resposta (ok ou erro)
            hideLoadingIndicator();

            if (!response.ok) {
                let errorMsg = `Erro HTTP ${response.status} ${response.statusText}`;
                try {
                    const errorData = await response.json();
                    if (errorData && errorData.error) {
                        errorMsg += `: ${errorData.error}`;
                    } else if (errorData && errorData.response) { // Captura erro vindo do "response"
                        errorMsg += `: ${errorData.response}`;
                    }
                } catch (e) { /* Ignora erro ao parsear JSON de erro */ }
                console.error('Erro na API:', errorMsg);
                addMessage(`😕 Oops! Algo deu errado no servidor. ${errorMsg}`, 'bot');
                return;
            }

            const data = await response.json();

            if (data && data.response) {
                const botResponseText = data.response;
                addMessage(botResponseText, 'bot'); // Exibe a resposta do bot

                // --- LÓGICA PARA SALVAR PEDIDO FINALIZADO NO KDS ---
                // Prioriza o objeto 'final_order' se existir
                if (data.final_order && data.final_order.items && data.final_order.items.length > 0) {
                    console.log("Pedido finalizado recebido com dados estruturados:", data.final_order);
                    
                    const kdsItems = data.final_order.items.map(item => ({
                        name: item.name, // Nome já deve estar no formato correto
                        quantity: item.quantity,
                        // price: item.price // Adicionar se o KDS precisar do preço unitário
                    }));

                    const orderDataForKDS = {
                        id: generateOrderId(),
                        items: kdsItems,
                        total: data.final_order.total ? parseFloat(data.final_order.total) : null,
                        timestamp: new Date().toISOString(),
                        status: 'Pendente',
                        orderDetailsText: data.final_order.order_details_text // Texto formatado do pedido
                    };
                    saveOrderToKitchen(orderDataForKDS);
                }
                // Fallback: Se final_order não existir, mas a frase de finalização estiver presente
                // (Isso pode acontecer se a finalização ocorrer por um fluxo antigo ou erro no backend ao montar final_order)
                else if (botResponseText.includes("Seu pedido foi anotado e enviado para a cozinha!")) {
                    console.warn("Finalização detectada, mas 'final_order' não disponível ou vazio. Usando fallback para KDS.");
                    saveOrderToKitchen({
                        id: generateOrderId(),
                        items: [{ name: "Pedido confirmado (detalhes via texto)", quantity: 1 }],
                        total: null, // Não temos o total estruturado neste caso
                        timestamp: new Date().toISOString(),
                        status: 'Pendente',
                        orderDetailsText: botResponseText // Salva a resposta completa do bot
                    });
                }
                // --- FIM DA LÓGICA DE FINALIZAÇÃO ---

            } else if (data && data.error) {
                 console.error("Erro retornado pela API:", data.error);
                 addMessage(`😕 Erro do servidor: ${data.error}`, 'bot');
            } else {
                 console.error("Resposta inválida ou vazia recebida da API:", data);
                 addMessage("Desculpe, não recebi uma resposta válida do servidor.", 'bot');
            }

        } catch (error) {
            // ESCONDE o indicador também em caso de erro geral de fetch
            hideLoadingIndicator();
            console.error('Erro geral ao chamar a API:', error);
            addMessage("Desculpe, ocorreu um erro ao conectar com o servidor. Verifique sua conexão ou tente mais tarde.", 'bot');
        }
    }

    /** Lida com o envio da mensagem pelo usuário */
    function handleSend() {
        const userText = userInput.value.trim();
        if (userText) {
            addMessage(userText, 'user');
            userInput.value = '';
            callChatAPI(userText);
        }
        userInput.focus();
    }

    // --- Event Listeners ---
    sendButton.addEventListener('click', handleSend);
    userInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            handleSend();
        }
    });

    /** Inicia a conversa com mensagens de boas-vindas */
    function startChat() {
        // Adiciona mensagens iniciais diretamente
        addMessage("Olá! Sou o assistente virtual do Restaurante Poliedro. 👋", 'bot');
        addMessage("Como posso ajudar você hoje?", 'bot');
        userInput.focus();
    }

    // Inicializa o chat
    startChat();
});