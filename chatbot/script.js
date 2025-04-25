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
        // Substitui \n por <br> para mensagens do bot para renderizar quebras de linha
        messageElement.innerHTML = sender === 'bot' ? text.replace(/\n/g, '<br>') : text;

        messageContent.appendChild(messageElement);

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
        const apiUrl = 'http://127.0.0.1:5000/chat'; // URL do backend Flask

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
            hideLoadingIndicator();
            hideTypingIndicator();

            if (!response.ok) {
                // Tenta ler a mensagem de erro do backend, se houver
                let errorMsg = `Erro HTTP ${response.status} ${response.statusText}`;
                try {
                    const errorData = await response.json();
                    if (errorData && errorData.error) {
                        errorMsg += `: ${errorData.error}`;
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
                // Verifica se a resposta contém a frase de finalização E os detalhes
                const finalizationPhrase = "Seu pedido foi enviado para a cozinha!";
                const hasDetails = botResponseText.includes("Total: R$") && botResponseText.includes("Pedido anotado:");

                if (botResponseText.includes(finalizationPhrase) && hasDetails) {
                    // console.log(">>> FINALIZAÇÃO DETECTADA COM DETALHES <<<"); // Log de debug removido

                    const orderId = generateOrderId();
                    let items = [];
                    let total = null;

                    // Extrai itens e total da MENSAGEM FINAL recebida do backend
                    try {
                        const itemsMatch = botResponseText.match(/Pedido anotado:(.*?)\. Total:/);
                        const totalMatch = botResponseText.match(/Total: R\$\s*([\d,.]+)/);

                        if (totalMatch && totalMatch[1]) {
                            total = parseFloat(totalMatch[1].replace('.', '').replace(',', '.')); // Trata milhares e decimal
                        }

                        if (itemsMatch && itemsMatch[1]) {
                            const itemsString = itemsMatch[1].trim();
                            // Regex para dividir itens, considerando "Nx " opcional
                            const itemParts = itemsString.split(/,\s*(?=(?:\d+\s*x\s+)?\S)|\s+e\s+(?=(?:\d+\s*x\s+)?\S)/);

                            items = itemParts.map(part => {
                                part = part.trim();
                                const match = part.match(/^(?:(\d+)\s*x\s+)?(.+)$/i);
                                if (match) {
                                    const quantity = match[1] ? parseInt(match[1], 10) : 1;
                                    const name = match[2].trim();
                                    // Remove possível "(Preço não encontrado)" adicionado pelo backend
                                    const cleanedName = name.replace(/\s*\(Preço não encontrado\)$/i, '').trim();
                                    return { name: cleanedName, quantity: quantity };
                                }
                                return null; // Ignora partes que não casam com o padrão
                            }).filter(item => item !== null && item.name); // Filtra nulos e itens sem nome

                            if (items.length === 0) {
                                 console.warn("Finalização detectada, mas não foi possível parsear itens da string:", itemsString);
                                 items = [{ name: "Pedido confirmado (detalhes indisponíveis)", quantity: 1 }]; // Fallback
                            }
                        } else {
                             console.warn("Finalização detectada, mas regex de itens não encontrou padrão.");
                             items = [{ name: "Pedido confirmado (detalhes indisponíveis)", quantity: 1 }]; // Fallback
                        }
                    } catch (parseError) {
                         console.error("Erro ao parsear detalhes do pedido finalizado:", parseError);
                         items = [{ name: "Pedido confirmado (erro ao parsear)", quantity: 1 }]; // Fallback
                         total = null;
                    }

                    // Monta os dados para salvar no KDS
                    const orderData = {
                        id: orderId,
                        items: items,
                        total: total, // Pode ser null se não foi parseado
                        timestamp: new Date().toISOString(),
                        status: 'Pendente' // Status inicial
                    };

                    console.log("Dados do pedido finalizado a serem salvos no KDS:", orderData);
                    saveOrderToKitchen(orderData);

                } else if (botResponseText.includes(finalizationPhrase)) {
                    // Finalizou, mas sem detalhes (talvez erro no backend ou fallback)
                    console.warn("Finalização detectada, mas SEM detalhes parseáveis na resposta.");
                    // Salva um pedido genérico para indicar que algo foi finalizado
                    saveOrderToKitchen({
                        id: generateOrderId(),
                        items: [{ name: "Pedido confirmado (sem detalhes)", quantity: 1 }],
                        total: null,
                        timestamp: new Date().toISOString(),
                        status: 'Pendente'
                    });
                }
                // --- FIM DA LÓGICA DE FINALIZAÇÃO ---

            } else if (data && data.error) {
                 // Se o backend retornou um erro JSON conhecido
                 console.error("Erro retornado pela API:", data.error);
                 addMessage(`😕 Erro do servidor: ${data.error}`, 'bot');
            } else {
                 // Resposta inesperada ou vazia
                 console.error("Resposta inválida ou vazia recebida da API:", data);
                 addMessage("Desculpe, não recebi uma resposta válida do servidor.", 'bot');
            }

        } catch (error) {
            // ESCONDE o indicador também em caso de erro geral de fetch
            hideLoadingIndicator();
            hideTypingIndicator();
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