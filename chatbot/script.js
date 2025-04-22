document.addEventListener('DOMContentLoaded', () => {
    const chatBox = document.getElementById('chat-box');
    const userInput = document.getElementById('user-input');
    const sendButton = document.getElementById('send-button');
    const resetButton = document.getElementById('reset-button');

    // Variable to hold the typing indicator element reference
    let typingIndicatorElement = null;

    // --- Helper Functions ---

    /** Gera um ID único para o pedido (simplificado) */
    function generateOrderId() {
        const now = new Date();
        const timePart = now.toTimeString().slice(0, 8).replace(/:/g, '');
        const randomPart = Math.floor(100 + Math.random() * 900);
        return `${timePart}-${randomPart}`;
    }

    /** Salva um pedido no localStorage para ser exibido no KDS */
    function saveOrderToKitchen(orderText) {
        console.log("Attempting to save order based on text:", orderText);
        const orderMatch = orderText.match(/Pedido anotado: (.*?)\. Total: R\$ ([\d,\.]+)\./);
        if (orderMatch && orderMatch.length >= 3) {
            const itemsString = orderMatch[1];
            const totalString = orderMatch[2].replace(',', '.');
            const total = parseFloat(totalString);

            const items = itemsString.split(', ').map(itemStr => {
                const itemMatch = itemStr.match(/(\d+)x (.*)/);
                return itemMatch ? { quantity: parseInt(itemMatch[1]), name: itemMatch[2].trim() } : null;
            }).filter(item => item !== null);

            if (items.length > 0 && !isNaN(total)) {
                const orderData = {
                    id: Date.now(),
                    items: items,
                    total: total,
                    timestamp: new Date().toISOString()
                };

                try {
                    let pendingOrders = JSON.parse(localStorage.getItem('pendingOrders') || '[]');
                    pendingOrders.push(orderData);
                    localStorage.setItem('pendingOrders', JSON.stringify(pendingOrders));
                    console.log('Pedido salvo no localStorage para KDS:', orderData);
                } catch (e) {
                    console.error("Erro ao salvar pedido no localStorage:", e);
                }
            } else {
                console.error("Não foi possível extrair itens ou total do texto do pedido:", orderText);
            }
        } else {
            console.error("Formato do texto de confirmação do pedido não reconhecido:", orderText);
        }
    }

    // --- Chat Interface Functions ---

    /** Adds a message or typing indicator to the chat box */
    function addMessage(text, sender, isTyping = false) {
        console.log(`DEBUG: addMessage called with text: "${text}", sender: ${sender}`);
        // Remove previous typing indicator if adding a real message or new indicator
        if (typingIndicatorElement && (!isTyping || sender === 'bot')) {
            typingIndicatorElement.remove();
            typingIndicatorElement = null;
        }

        const messageWrapper = document.createElement('div');
        messageWrapper.classList.add('message-wrapper', sender);

        const avatar = document.createElement('div');
        avatar.classList.add('avatar');
        avatar.innerHTML = sender === 'bot' ? '<i class="fas fa-robot"></i>' : 'U'; // Use icon for bot

        // --- FIX: Only append avatar if sender is 'bot' ---
        if (sender === 'bot') {
            messageWrapper.appendChild(avatar); // Add avatar first for bot
        }
        // --------------------------------------------------

        const messageContent = document.createElement('div');
        messageContent.classList.add('message-content');

        if (isTyping && sender === 'bot') {
            // Create typing indicator element
            const typingDiv = document.createElement('div');
            typingDiv.classList.add('message', 'typing-indicator'); // Add message class for basic styling
            typingDiv.innerHTML = `<span></span><span></span><span></span>`;
            messageContent.appendChild(typingDiv);
            typingIndicatorElement = messageWrapper; // Store reference to remove later
        } else {
            // Create regular message element
            const messageElement = document.createElement('div');
            messageElement.classList.add('message');
            // Basic HTML rendering (replace newline with <br>) - careful with complex HTML
            messageElement.innerHTML = text.replace(/\n/g, '<br>');
            messageContent.appendChild(messageElement);
        }

        messageWrapper.appendChild(messageContent); // Append the content div

        // --- FIX: Only append avatar if sender is 'user' ---
        if (sender === 'user') {
            messageWrapper.appendChild(avatar); // Add avatar last for user
        }
        // ---------------------------------------------------

        chatBox.appendChild(messageWrapper);
        console.log("DEBUG: Message wrapper appended:", messageWrapper);
        scrollToBottom();
        // Return the actual message element if it was created (not the wrapper)
        return messageContent.querySelector('.message:not(.typing-indicator)');
    }

    /** Shows the typing indicator */
    function showTypingIndicator() {
        addMessage('', 'bot', true);
    }

    /** Removes the typing indicator */
    function hideTypingIndicator() {
        if (typingIndicatorElement) {
            typingIndicatorElement.remove();
            typingIndicatorElement = null;
        }
    }

    /** Scrolls the chat box to the bottom */
    function scrollToBottom() {
        chatBox.scrollTop = chatBox.scrollHeight;
    }

    // --- Main Function: Call Backend API ---
    async function sendMessage() {
        const messageText = userInput.value.trim();
        if (!messageText) return;

        addMessage(messageText, 'user');
        userInput.value = '';
        showTypingIndicator();
        setLoading(true);

        try {
            const response = await fetch('http://localhost:5000/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: messageText }),
            });

            hideTypingIndicator();

            if (!response.ok) {
                const errorText = await response.text();
                addMessage(`Erro: ${response.status} - ${errorText}`, 'bot error');
                return;
            }

            const contentType = response.headers.get("content-type");

            if (contentType && contentType.includes("application/json")) {
                const data = await response.json();
                const botResponseText = data.response;
                addMessage(botResponseText, 'bot');
                saveOrderToKitchen(botResponseText);
            } else {
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let botMessageElement = addMessage('', 'bot');
                let currentBotText = '';

                while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    const chunk = decoder.decode(value, { stream: true });
                    currentBotText += chunk;
                    botMessageElement.innerHTML = currentBotText.replace(/\n/g, '<br>');
                    scrollToBottom();
                }
            }

        } catch (error) {
            hideTypingIndicator();
            console.error('Erro ao enviar mensagem:', error);
            addMessage('Oops! Algo deu errado ao conectar com o chatbot.', 'bot error');
        } finally {
            setLoading(false);
        }
    }

    /** Function to reset the chat */
    async function resetChat() {
        console.log("Resetando conversa...");
        chatBox.innerHTML = '';
        startChat();

        try {
            const response = await fetch('http://localhost:5000/reset', { method: 'POST' });
            const data = await response.json();
            console.log("Reset response:", data.message);
        } catch (error) {
            console.error('Erro ao resetar histórico no backend:', error);
        }
    }

    /** Shows or hides the loading state */
    function setLoading(isLoading) {
        sendButton.disabled = isLoading;
        userInput.disabled = isLoading;
        sendButton.innerHTML = isLoading ? '<i class="fas fa-spinner fa-spin"></i>' : '<i class="fas fa-paper-plane"></i>';
    }

    // --- Event Listeners ---
    sendButton.addEventListener('click', sendMessage);
    userInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter' && !userInput.disabled) {
            sendMessage();
        }
    });
    resetButton.addEventListener('click', resetChat);

    /** Starts the chat with a greeting */
    function startChat() {
        console.log("DEBUG: startChat function called."); // Add this
        addMessage('Olá! Bem-vindo ao Restaurante Poliedro. Como posso ajudar?', 'bot');
        userInput.focus();
        console.log("DEBUG: startChat function finished."); // Add this
    }

    // Initialize the chat on page load
    console.log("DEBUG: Initializing chat..."); // Add this
    startChat();
});