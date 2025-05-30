document.addEventListener('DOMContentLoaded', () => {
    // Elementos da DOM para a visualização do KDS e Pedidos Finalizados
    const kdsView = document.getElementById('kds-view'); // Contêiner da visualização KDS
    const kdsOrdersList = document.getElementById('kds-orders-list'); // Lista para pedidos Pendentes/Em Preparo
    const finishedOrdersList = document.getElementById('finished-orders-list'); // Lista para pedidos Prontos
    const notificationSound = document.getElementById('notification-sound'); // Áudio para novos pedidos
    const navTabs = document.querySelectorAll('.nav-tab'); // Abas de navegação

    // Conjuntos para rastrear IDs de pedidos já exibidos em cada lista, para evitar duplicatas e tocar som de notificação corretamente
    let displayedKdsOrderIds = new Set();
    let displayedFinishedOrderIds = new Set();
    let activeTab = 'kds-view'; // Aba ativa por padrão, será confirmada ao carregar
    let pollingIntervalId = null; // ID do intervalo de polling para poder limpá-lo
    const POLLING_INTERVAL = 15000; // Intervalo de busca de novos pedidos (em milissegundos)
    const FLASK_API_BASE_URL = 'http://127.0.0.1:5000'; // URL base da API Flask

    // --- Funções de Busca e Exibição de Pedidos ---

    // Busca pedidos para um único status (ex: "Pronto")
    async function fetchSingleStatusOrders(status, targetListElement, displayedIdsSet) {
        if (!targetListElement) {
            console.error(`Elemento da lista alvo não encontrado para o status ${status}!`);
            return;
        }
        // Exibe mensagem de carregamento se a lista estiver vazia e sem mensagem de erro
        if (!targetListElement.querySelector('.kds-order-item') && !targetListElement.querySelector('.error-message')) {
            targetListElement.innerHTML = `<li class="no-orders">Carregando pedidos (${status.toLowerCase()})...</li>`;
        }
        
        const apiUrl = `${FLASK_API_BASE_URL}/api/kds/orders?status=${status}`;
        console.log(`Tentando buscar ${apiUrl}...`);
        
        try {
            const response = await fetch(apiUrl);
            if (!response.ok) {
                console.error(`Erro ao buscar pedidos (status ${status}):`, response.status, response.statusText);
                targetListElement.innerHTML = `<li class="no-orders error-message">Erro ao carregar pedidos (${status.toLowerCase()}). Tente novamente.</li>`;
                return;
            }
            const orders = await response.json();
            displayOrders(orders, targetListElement, displayedIdsSet);
        } catch (error) {
            console.error(`Falha na requisição de pedidos (status ${status}):`, error);
            targetListElement.innerHTML = `<li class="no-orders error-message">Falha ao conectar com o servidor (${status.toLowerCase()}).</li>`;
        }
    }

    // Busca, combina e ordena pedidos para a visualização KDS (Pendente & Em Preparo)
    async function fetchAndDisplayKdsViewOrders() {
        // Exibe mensagem de carregamento se a lista KDS estiver vazia e sem mensagem de erro
        if (!kdsOrdersList.querySelector('.kds-order-item') && !kdsOrdersList.querySelector('.error-message')) {
            kdsOrdersList.innerHTML = `<li class="no-orders">Carregando pedidos ativos...</li>`;
        }

        try {
            // Busca pedidos pendentes e em preparo em paralelo
            const [pendenteResponse, emPreparoResponse] = await Promise.all([
                fetch(`${FLASK_API_BASE_URL}/api/kds/orders?status=Pendente`),
                fetch(`${FLASK_API_BASE_URL}/api/kds/orders?status=Em Preparo`)
            ]);

            let pendenteOrders = [];
            let emPreparoOrders = [];

            if (pendenteResponse.ok) {
                pendenteOrders = await pendenteResponse.json();
            } else {
                console.error('Erro ao buscar Pedente:', pendenteResponse.status, pendenteResponse.statusText);
            }

            if (emPreparoResponse.ok) {
                emPreparoOrders = await emPreparoResponse.json();
            } else {
                console.error('Erro ao buscar Em Preparo:', emPreparoResponse.status, emPreparoResponse.statusText);
            }
            
            // Se ambas as buscas falharem, exibe mensagem de erro geral
            if (!pendenteResponse.ok && !emPreparoResponse.ok) {
                 kdsOrdersList.innerHTML = `<li class="no-orders error-message">Erro ao carregar pedidos ativos. Tente novamente.</li>`;
                 return;
            }

            const combinedOrders = [...pendenteOrders, ...emPreparoOrders];
            // Ordena por timestamp ascendente (mais antigos primeiro)
            combinedOrders.sort((a, b) => new Date(a.timestamp_iso) - new Date(b.timestamp_iso)); 

            displayOrders(combinedOrders, kdsOrdersList, displayedKdsOrderIds);

        } catch (error) {
            console.error(`Falha na requisição de pedidos para KDS View:`, error);
            kdsOrdersList.innerHTML = `<li class="no-orders error-message">Falha ao conectar com o servidor (KDS View).</li>`;
        }
    }

    // Função genérica para exibir pedidos em uma lista alvo
    function displayOrders(orders, targetListElement, displayedIdsSet) {
        if (!targetListElement) return;

        // Define mensagens para quando não há pedidos
        if (orders.length === 0) {
            if (targetListElement === kdsOrdersList) {
                targetListElement.innerHTML = `<li class="no-orders">Nenhum pedido pendente ou em preparo no momento.</li>`;
            } else if (targetListElement === finishedOrdersList) {
                targetListElement.innerHTML = `<li class="no-orders">Nenhum pedido finalizado no momento.</li>`;
            } else {
                targetListElement.innerHTML = `<li class="no-orders">Nenhum pedido no momento.</li>`; // Fallback genérico
            }
            displayedIdsSet.clear(); // Limpa o set de IDs exibidos
            return;
        }

        const newOrderIds = new Set(); // IDs dos pedidos atuais recebidos
        let newOrdersArrived = false; // Flag para tocar som de notificação
        const fragment = document.createDocumentFragment(); // Para otimizar manipulação da DOM

        orders.forEach(order => {
            newOrderIds.add(order._id);
            if (!displayedIdsSet.has(order._id)) {
                newOrdersArrived = true; // Novo pedido chegou
            }

            const listItem = document.createElement('li');
            listItem.className = 'kds-order-item card';
            listItem.dataset.orderId = order._id;

            let itemsHtml = '<ul class="order-item-list">';
            order.items.forEach(item => {
                itemsHtml += `<li>${item.quantity}x ${item.name}</li>`;
            });
            itemsHtml += '</ul>';

            let orderDateTimeFormatted;
            if (order.timestamp_iso) {
                const dateObj = new Date(order.timestamp_iso);
                const timeOptions = { 
                    hour: '2-digit', 
                    minute: '2-digit', 
                    timeZone: 'America/Sao_Paulo' // Fuso horário de Brasília
                };
                // Formatação diferente para a lista de pedidos finalizados (inclui data)
                if (targetListElement === finishedOrdersList) {
                    const dateOptions = {
                        day: '2-digit',
                        month: '2-digit',
                        timeZone: 'America/Sao_Paulo'
                    };
                    orderDateTimeFormatted = `${dateObj.toLocaleDateString('pt-BR', dateOptions)} ${dateObj.toLocaleTimeString('pt-BR', timeOptions)}`;
                } else {
                    orderDateTimeFormatted = dateObj.toLocaleTimeString('pt-BR', timeOptions);
                }
            } else {
                orderDateTimeFormatted = 'N/A'; // Caso não haja timestamp
            }

            // Botões de ação são exibidos apenas para pedidos Pendentes ou Em Preparo
            let actionButtonsHtml = '';
            if (order.status === 'Pendente' || order.status === 'Em Preparo') {
                actionButtonsHtml = `
                    <button class="btn-kds-action btn-mark-preparando" data-id="${order._id}" ${order.status === 'Em Preparo' ? 'disabled' : ''}>Preparando</button>
                    <button class="btn-kds-action btn-mark-pronto" data-id="${order._id}">Pronto</button>
                `;
            }
            // Poderia adicionar botões para pedidos Prontos aqui, como "Reabrir"

            listItem.innerHTML = `
                <div class="order-header">
                    <span class="order-id">Pedido #${order._id.slice(-6)}</span>
                    <span class="order-time"><i class="fas fa-clock"></i> ${orderDateTimeFormatted}</span>
                </div>
                <div class="order-body">
                    ${itemsHtml}
                </div>
                <div class="order-footer">
                    <span class="order-status status-${order.status.toLowerCase().replace(/\s+/g, '-')}">${order.status}</span>
                    <div class="order-actions"> 
                        ${actionButtonsHtml}
                    </div>
                </div>
            `;
            fragment.appendChild(listItem);
        });
        
        targetListElement.innerHTML = ''; // Limpa conteúdo anterior antes de adicionar o novo
        targetListElement.appendChild(fragment);

        // Atualiza o conjunto de IDs exibidos para a lista específica
        if (targetListElement === kdsOrdersList) displayedKdsOrderIds = newOrderIds;
        if (targetListElement === finishedOrdersList) displayedFinishedOrderIds = newOrderIds;

        // Toca som apenas para novos pedidos na visualização KDS (Pendente/Em Preparo)
        if (newOrdersArrived && notificationSound && targetListElement === kdsOrdersList) {
            notificationSound.play().catch(e => console.warn("Erro ao tocar som de notificação:", e));
        }

        // Reatribui event listeners aos botões de ação após redesenhar a lista
        document.querySelectorAll(`#${targetListElement.id} .btn-mark-preparando`).forEach(button => {
            button.removeEventListener('click', handlePreparandoClick); // Remove listener antigo para evitar duplicação
            button.addEventListener('click', handlePreparandoClick);
        });
        document.querySelectorAll(`#${targetListElement.id} .btn-mark-pronto`).forEach(button => {
            button.removeEventListener('click', handleProntoClick);
            button.addEventListener('click', handleProntoClick);
        });
    }
    
    // Manipuladores para cliques nos botões de status
    function handlePreparandoClick(event) {
        handleOrderStatusUpdate(event.target.dataset.id, 'Em Preparo');
    }
    function handleProntoClick(event) {
        handleOrderStatusUpdate(event.target.dataset.id, 'Pronto');
    }

    // Função para atualizar o status de um pedido via API
    async function handleOrderStatusUpdate(orderId, newStatus) {
        console.log(`Tentando atualizar pedido ${orderId} para status ${newStatus}`);
        const apiUrl = `${FLASK_API_BASE_URL}/api/kds/order/${orderId}/status`;

        try {
            const response = await fetch(apiUrl, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus }),
            });

            const responseData = await response.json();

            if (response.ok) {
                console.log(`Status do pedido ${orderId} atualizado para ${newStatus} com sucesso:`, responseData.message);
                
                // Atualiza a visualização KDS (Pendente & Em Preparo)
                fetchAndDisplayKdsViewOrders();
                
                // Atualiza a visualização de Pedidos Finalizados se estiver ativa ou se um pedido foi movido para/de Pronto
                if (activeTab === 'finished-orders-view' || newStatus === 'Pronto' || (orderId && displayedFinishedOrderIds.has(orderId) && newStatus !== 'Pronto')) {
                    fetchSingleStatusOrders('Pronto', finishedOrdersList, displayedFinishedOrderIds);
                }

            } else {
                console.error(`Erro ao atualizar status do pedido ${orderId}: ${response.status} ${response.statusText}`, responseData);
                alert(`Erro ao atualizar status do pedido: ${responseData.error || response.statusText}`);
            }
        } catch (error) {
            console.error(`Erro de rede ou outro erro ao atualizar status do pedido ${orderId}:`, error);
            alert('Erro de rede ao tentar atualizar o status do pedido. Verifique a conexão com o servidor.');
        }
    }

    // --- Lógica de Polling ---

    // Inicia o polling para a aba ativa
    function startPollingForActiveTab() {
        stopPolling(); // Garante que qualquer polling anterior seja interrompido
        if (activeTab === 'kds-view') {
            fetchAndDisplayKdsViewOrders(); // Busca inicial
            pollingIntervalId = setInterval(fetchAndDisplayKdsViewOrders, POLLING_INTERVAL);
        } else if (activeTab === 'finished-orders-view') {
            fetchSingleStatusOrders('Pronto', finishedOrdersList, displayedFinishedOrderIds); // Busca inicial
            pollingIntervalId = setInterval(() => fetchSingleStatusOrders('Pronto', finishedOrdersList, displayedFinishedOrderIds), POLLING_INTERVAL);
        }
        // A aba Admin não necessita de polling contínuo de pedidos
    }

    // Para o polling
    function stopPolling() {
        if (pollingIntervalId) {
            clearInterval(pollingIntervalId);
            pollingIntervalId = null;
        }
    }

    // --- Navegação por Abas ---
    navTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetViewId = tab.dataset.target; // ID da view alvo (ex: 'kds-view')
            activeTab = targetViewId; 

            // Remove a classe 'active-view' de todas as views e 'active' de todas as abas
            document.querySelectorAll('.main-view').forEach(view => view.classList.remove('active-view'));
            navTabs.forEach(t => t.classList.remove('active'));

            // Adiciona a classe 'active-view' à view alvo e 'active' à aba clicada
            const targetView = document.getElementById(targetViewId);
            if (targetView) {
                targetView.classList.add('active-view');
            }
            tab.classList.add('active');

            startPollingForActiveTab(); // Reinicia o polling para a nova aba ativa

            // Se a aba Admin for selecionada, busca o cardápio
            if (targetViewId === 'admin-view') {
                fetchMenu(); 
            }
        });
    });

    // Define o estado inicial da aba e inicia o polling
    const initiallyActiveTabButton = document.querySelector('.nav-tab.active');
    if (initiallyActiveTabButton) {
        activeTab = initiallyActiveTabButton.dataset.target;
    } else {
        // Fallback se nenhuma aba estiver marcada como ativa no HTML, assume 'kds-view'
        activeTab = 'kds-view';
        document.getElementById('tab-kds')?.classList.add('active'); // Adiciona classe 'active' à aba KDS
        document.getElementById('kds-view')?.classList.add('active-view'); // Exibe a view KDS
    }
    startPollingForActiveTab(); // Inicia o polling para a aba ativa inicial


    // --- Lógica de Gerenciamento de Cardápio (Aba Admin) ---
    const menuItemForm = document.getElementById('menu-item-form'); // Formulário de adição/edição
    const menuTableBody = document.getElementById('menu-table-body'); // Corpo da tabela do cardápio
    const noMenuItemsRow = document.getElementById('no-menu-items-row'); // Linha "Nenhum item"
    const editItemIdField = document.getElementById('edit-item-id'); // Campo oculto para ID do item em edição
    const itemNameField = document.getElementById('item-name'); // Campo nome do item
    const itemPriceField = document.getElementById('item-price'); // Campo preço do item
    const saveButton = document.getElementById('save-button'); // Botão Salvar/Adicionar
    const cancelEditButton = document.getElementById('cancel-edit-button'); // Botão Cancelar Edição
    const formMessage = document.getElementById('form-message'); // Para exibir mensagens de status/erro

    // Busca o cardápio da API e o renderiza na tabela
    async function fetchMenu() {
        if (!menuTableBody) return; // Garante que os elementos da view Admin existam
        try {
            formMessage.textContent = 'Carregando cardápio...';
            formMessage.className = 'admin-form-message'; // Classe padrão para mensagens
            const response = await fetch(`${FLASK_API_BASE_URL}/menu`);
            if (!response.ok) {
                throw new Error(`Erro HTTP: ${response.status}`);
            }
            const data = await response.json();
            renderMenu(data.menu || []); // data.menu deve ser o array de itens
            formMessage.textContent = ''; // Limpa mensagem após sucesso
        } catch (error) {
            console.error("Erro ao buscar cardápio:", error);
            renderMenu([]); // Renderiza um menu vazio em caso de erro
            formMessage.textContent = 'Erro ao carregar o cardápio.';
            formMessage.className = 'admin-form-message error'; // Classe para erro
        }
    }

    // Renderiza os itens do cardápio na tabela
    function renderMenu(menuItems) {
        if (!menuTableBody || !noMenuItemsRow) return;
        menuTableBody.innerHTML = ''; // Limpa a tabela antes de renderizar

        if (!menuItems || menuItems.length === 0) {
            noMenuItemsRow.style.display = ''; // Mostra a linha "Nenhum item"
            return;
        }
        noMenuItemsRow.style.display = 'none'; // Esconde a linha "Nenhum item"

        menuItems.forEach(item => {
            const row = menuTableBody.insertRow();
            row.insertCell().textContent = item.name;
            // Garante que o preço seja um número e o formata; o backend envia como string
            row.insertCell().textContent = parseFloat(item.price).toFixed(2); 

            const actionsCell = row.insertCell();
            actionsCell.className = 'action-buttons'; // Para estilização dos botões

            const editButton = document.createElement('button');
            editButton.innerHTML = '<i class="fas fa-edit"></i> Editar';
            editButton.className = 'btn btn-edit';
            editButton.onclick = () => populateFormForEdit(item); // item.id é o _id do MongoDB
            actionsCell.appendChild(editButton);

            const deleteButton = document.createElement('button');
            deleteButton.innerHTML = '<i class="fas fa-trash"></i> Excluir';
            deleteButton.className = 'btn btn-danger';
            deleteButton.onclick = () => deleteMenuItem(item.id); // Usa item.id (MongoDB _id)
            actionsCell.appendChild(deleteButton);
        });
    }

    // Preenche o formulário para edição de um item existente
    function populateFormForEdit(item) {
        editItemIdField.value = item.id; // Armazena o _id do MongoDB aqui
        itemNameField.value = item.name;
        itemPriceField.value = parseFloat(item.price).toFixed(2); // Formata preço para exibição
        saveButton.innerHTML = '<i class="fas fa-save"></i> Salvar Alterações';
        saveButton.classList.remove('btn-primary'); // Muda cor do botão para indicar edição (opcional)
        saveButton.classList.add('btn-success');
        cancelEditButton.style.display = 'inline-block'; // Mostra botão de cancelar edição
        formMessage.textContent = ''; // Limpa mensagens anteriores
        itemNameField.focus(); // Foca no campo nome
    }

    // Reseta o formulário para o estado de adição de novo item
    function resetForm() {
        menuItemForm.reset(); // Limpa os campos do formulário
        editItemIdField.value = ''; // Limpa o ID do item em edição
        saveButton.innerHTML = '<i class="fas fa-plus"></i> Adicionar Item';
        saveButton.classList.remove('btn-success'); // Restaura cor padrão do botão
        saveButton.classList.add('btn-primary');
        cancelEditButton.style.display = 'none'; // Esconde botão de cancelar edição
        formMessage.textContent = '';
    }

    // Exclui um item do cardápio via API
    async function deleteMenuItem(itemId) {
        if (!itemId) {
            console.error("deleteMenuItem: ID do item não fornecido.");
            return;
        }
        if (!confirm("Tem certeza que deseja excluir este item do cardápio?")) {
            return;
        }
        try {
            formMessage.textContent = 'Excluindo item...';
            formMessage.className = 'admin-form-message';
            const response = await fetch(`${FLASK_API_BASE_URL}/api/menu/items/${itemId}`, { method: 'DELETE' });
            const responseData = await response.json();

            if (response.ok) {
                formMessage.textContent = responseData.message || 'Item excluído com sucesso!';
                formMessage.className = 'admin-form-message success';
                fetchMenu(); // Recarrega a lista de itens do cardápio
            } else {
                formMessage.textContent = `Erro: ${responseData.error || response.statusText}`;
                formMessage.className = 'admin-form-message error';
            }
        } catch (error) {
            console.error("Erro ao excluir item:", error);
            formMessage.textContent = 'Erro de conexão ao excluir o item.';
            formMessage.className = 'admin-form-message error';
        }
    }

    // Event listener para o botão de cancelar edição
    if (cancelEditButton) {
        cancelEditButton.addEventListener('click', resetForm);
    }

    // Event listener para submissão do formulário de item do cardápio
    if (menuItemForm) {
        menuItemForm.addEventListener('submit', async function(event) {
            event.preventDefault(); // Previne submissão padrão do formulário
            formMessage.textContent = ''; // Limpa mensagens anteriores

            const name = itemNameField.value.trim();
            const priceStr = itemPriceField.value.trim().replace(',', '.'); // Permite vírgula como separador decimal
            const editingItemId = editItemIdField.value; // Pega ID se estiver editando

            // Validação básica dos campos
            if (!name || priceStr === '' || isNaN(parseFloat(priceStr)) || parseFloat(priceStr) < 0) {
                formMessage.textContent = 'Por favor, preencha nome e preço válido (maior ou igual a zero).';
                formMessage.className = 'admin-form-message error';
                return;
            }
            const price = parseFloat(priceStr).toFixed(2); // Formata preço para duas casas decimais

            try {
                formMessage.textContent = 'Salvando cardápio...';
                formMessage.className = 'admin-form-message';

                // 1. Busca o cardápio atual para modificá-lo
                const currentMenuResponse = await fetch(`${FLASK_API_BASE_URL}/menu`);
                if (!currentMenuResponse.ok) throw new Error('Falha ao buscar cardápio atual para salvar.');
                const currentMenuData = await currentMenuResponse.json();
                let menuToSave = currentMenuData.menu || []; // Array de itens do cardápio

                if (editingItemId) { // Se estiver editando um item existente
                    const itemIndex = menuToSave.findIndex(item => item.id === editingItemId);
                    if (itemIndex > -1) {
                        // Atualiza o item existente
                        menuToSave[itemIndex] = { ...menuToSave[itemIndex], name, price };
                    } else {
                        // Item não encontrado (improvável se o ID estiver correto), adiciona como novo por segurança
                        menuToSave.push({ name, price }); 
                    }
                } else { // Se estiver adicionando um novo item
                    // Verifica se já existe um item com o mesmo nome (opcional, para melhor UX)
                    const existingItemIndex = menuToSave.findIndex(item => item.name.toLowerCase() === name.toLowerCase());
                    if (existingItemIndex > -1) {
                        if (!confirm(`Um item com o nome "${name}" já existe. Deseja substituí-lo/atualizá-lo?`)) {
                            formMessage.textContent = 'Operação cancelada.';
                            formMessage.className = 'admin-form-message';
                            return;
                        }
                        // Se confirmado, remove o item existente para substituí-lo
                        menuToSave.splice(existingItemIndex, 1);
                    }
                    menuToSave.push({ name, price }); // Adiciona o novo item
                }
                
                // Ordena o cardápio alfabeticamente por nome (opcional, para consistência)
                menuToSave.sort((a, b) => a.name.localeCompare(b.name));

                // 2. Envia (POST) o cardápio inteiro atualizado para o backend
                const response = await fetch(`${FLASK_API_BASE_URL}/menu`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ menu: menuToSave }) // Envia o array de itens dentro de um objeto { menu: [...] }
                });
                const responseData = await response.json();

                if (response.ok) {
                    formMessage.textContent = responseData.message || `Cardápio ${editingItemId ? 'atualizado' : 'salvo'} com sucesso!`;
                    formMessage.className = 'admin-form-message success';
                    resetForm(); // Limpa o formulário
                    fetchMenu(); // Recarrega a tabela do cardápio
                } else {
                    formMessage.textContent = `Erro: ${responseData.error || response.statusText}`;
                    formMessage.className = 'admin-form-message error';
                }
            } catch (error) {
                console.error("Erro ao salvar item:", error);
                formMessage.textContent = `Erro de conexão ao salvar o item: ${error.message}`;
                formMessage.className = 'admin-form-message error';
            }
        });
    }
    // A lógica de carregar o cardápio inicial para a aba admin já está integrada
    // ao manipulador de clique de abas e à configuração inicial da aba ativa.
});