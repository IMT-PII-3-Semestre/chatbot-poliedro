document.addEventListener('DOMContentLoaded', () => {
    const chatBox = document.getElementById('chat-box');
    const userInput = document.getElementById('user-input');
    const sendButton = document.getElementById('send-button');
    const newChatButton = document.getElementById('new-chat-button');

    // Define a URL base da API para o chat
    const API_BASE_URL = 'http://127.0.0.1:5000';

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

    // --- Funções para Indicador de "Digitando" no Botão ---

    /** Mostra o indicador de "digitando" no botão */
    function showTypingIndicator() {
        sendButton.classList.add('typing');
        sendButton.disabled = true; // Desabilita o botão
        userInput.disabled = true; // Opcional: desabilitar input também
    }

    /** Esconde o indicador de "digitando" no botão */
    function hideTypingIndicator() {
        sendButton.classList.remove('typing');
        sendButton.disabled = false; // Habilita o botão
        userInput.disabled = false; // Opcional: habilitar input também
    }

    // --- Função Principal: Chamar API do Backend ---
    async function callChatAPI(userMessage) {
        const apiUrl = `${API_BASE_URL}/chat`; // URL absoluta para o backend Flask

        // MOSTRA o indicador ANTES de chamar a API
        showLoadingIndicator();
        showTypingIndicator();

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
            // ESCONDE o indicador ANTES de processar a resposta (ok ou erro)
            // hideLoadingIndicator(); // Already called before this block if fetch succeeded
            // hideTypingIndicator(); // Already called before this block if fetch succeeded

            if (!response.ok) {
                // Indicators are already hidden by this point by the calls made after fetch() completes (successfully or not)
                // and before this !response.ok check.

                let userFriendlyMessage = "";
                try {
                    const errorData = await response.json();
                    if (errorData && errorData.error) {
                        userFriendlyMessage = `😕 Oops! Algo deu errado no servidor: ${errorData.error}`;
                    } else if (errorData && errorData.response) {
                        userFriendlyMessage = `😕 Oops! Algo deu errado no servidor: ${errorData.response}`;
                    } else {
                        // Se não houver errorData.error ou errorData.response, montar uma mensagem baseada no status
                        throw new Error("No specific error message in JSON body");
                    }
                } catch (e) { // Falha ao parsear JSON ou campos esperados não encontrados
                    console.warn('Não foi possível parsear JSON da resposta de erro ou campos esperados ausentes:', e);
                    if (response.status === 500) {
                        userFriendlyMessage = "Ocorreu um erro interno no servidor. Por favor, tente novamente mais tarde.";
                    } else if (response.status === 400) {
                        userFriendlyMessage = `Requisição inválida (HTTP ${response.status}): ${response.statusText}. Verifique os dados enviados.`;
                    } else if (response.status === 404) {
                        userFriendlyMessage = `Recurso não encontrado (HTTP ${response.status}): ${response.statusText}.`;
                    } else {
                        userFriendlyMessage = `😕 Oops! Algo deu errado (HTTP ${response.status} ${response.statusText}). Por favor, tente novamente.`;
                    }
                }
                console.error('Erro na API:', response.status, response.statusText);
                addMessage(userFriendlyMessage, 'bot');
                return;
            }

            // Indicators should have been hidden before this point if response was .ok
            // hideLoadingIndicator(); // Already called
            // hideTypingIndicator(); // Already called

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
            hideTypingIndicator();
            console.error('Erro geral ao chamar a API:', error);

            if (error instanceof TypeError) { // Network error, server down, CORS etc.
                addMessage("Não foi possível conectar ao servidor. Verifique sua conexão ou tente mais tarde.", 'bot');
            } else { // Other unexpected errors
                addMessage("Ocorreu um erro inesperado ao processar sua solicitação. Por favor, tente novamente.", 'bot');
            }
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

    /** Inicia uma nova conversa, limpando o histórico e reiniciando a sessão */
    async function startNewChat() {
        chatBox.innerHTML = ''; // Clear current messages
        addMessage("Iniciando uma nova conversa...", "bot"); // Show feedback

        // Attempt to notify the backend to reset the session (if such an endpoint exists or is added)
        // For now, we'll assume no specific backend endpoint and just clear client-side state
        // and restart the conversation flow.
        // A more robust solution would involve a backend call to session.clear() or similar.

        // Simulate backend session reset by sending a generic greeting that should restart the conversation.
        // This relies on the backend treating "oi" or a similar generic greeting as the start of a new interaction
        // and clearing/resetting any previous state like conversation_history or cart in the session.
        // The current backend's /chat endpoint re-initializes session['cart'] etc. if not present,
        // but doesn't explicitly clear them on a "new chat" command.
        // The most effective way to truly start fresh with the current backend is to make it forget the old session.
        // This often means clearing cookies or the backend session store, which is hard from client JS alone without a dedicated endpoint.

        // For now, we will send a message that *should* be interpreted as a new start by the LLM.
        // And rely on the user potentially having to say "cancelar pedido" if an old one was in progress.
        userInput.value = ''; // Clear input field
        // Consider if startChat() should be called before or after, or integrated.
        // For now, callChatAPI will trigger bot's response which might include welcome if history is cleared by backend.
        await callChatAPI('Olá, gostaria de começar uma nova conversa.'); // Send a clear intent to start over.
        userInput.focus();
        console.log("Solicitação de nova conversa enviada.");
        // If startChat() is called here, it might add duplicate welcome messages if callChatAPI also triggers them.
        // Let's rely on callChatAPI to refresh the conversation.
        // If the LLM doesn't provide a greeting, then startChat() might be needed after clearing chatBox.
        // The original startChat() also adds messages directly.
        // Let's refine: clear, add placeholder, then let callChatAPI handle the new flow.
        // If the backend doesn't reset well, then we might need to call startChat() to paint default welcome.
    }

    // --- Event Listeners ---
    sendButton.addEventListener('click', handleSend);
    userInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            handleSend();
        }
    });
    newChatButton.addEventListener('click', startNewChat);

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