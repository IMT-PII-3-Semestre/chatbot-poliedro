document.addEventListener('DOMContentLoaded', () => {
    const kdsView = document.getElementById('kds-view');
    const kdsOrdersList = document.getElementById('kds-orders-list');
    const finishedOrdersList = document.getElementById('finished-orders-list');
    const notificationSound = document.getElementById('notification-sound');
    // const tabKds = document.getElementById('tab-kds'); // Not directly used, navTabs handles it
    // const tabFinished = document.getElementById('tab-finished'); // Not directly used
    // const tabAdmin = document.getElementById('tab-admin'); // Not directly used
    // const adminView = document.getElementById('admin-view'); // Not directly used
    const navTabs = document.querySelectorAll('.nav-tab');

    let displayedKdsOrderIds = new Set();
    let displayedFinishedOrderIds = new Set();
    let activeTab = 'kds-view'; // Default, will be confirmed on load
    let pollingIntervalId = null;
    const POLLING_INTERVAL = 15000; // 15 segundos

    // --- Funções de Fetch e Display ---

    // Fetches orders for a single status (e.g., "Pronto")
    async function fetchSingleStatusOrders(status, targetListElement, displayedIdsSet) {
        if (!targetListElement) {
            console.error(`Target list element not found for status ${status}!`);
            return;
        }
        if (!targetListElement.querySelector('.kds-order-item') && !targetListElement.querySelector('.error-message')) {
            targetListElement.innerHTML = `<li class="no-orders">Carregando pedidos (${status.toLowerCase()})...</li>`;
        }
        
        const apiUrl = `http://127.0.0.1:5000/api/kds/orders?status=${status}`;
        console.log(`Attempting to fetch ${apiUrl}...`);
        
        try {
            const response = await fetch(apiUrl);
            if (!response.ok) {
                console.error(`Erro ao buscar pedidos (status ${status}):`, response.status, response.statusText);
                targetListElement.innerHTML = `<li class="no-orders error-message">Erro ao carregar pedidos (${status.toLowerCase()}). Tente novamente.</li>`;
                return;
            }
            const orders = await response.json();
            displayOrders(orders, targetListElement, displayedIdsSet); // Pass only necessary params
        } catch (error) {
            console.error(`Falha na requisição de pedidos (status ${status}):`, error);
            targetListElement.innerHTML = `<li class="no-orders error-message">Falha ao conectar com o servidor (${status.toLowerCase()}).</li>`;
        }
    }

    // Fetches, combines, and sorts orders for the KDS view (Pendente & Em Preparo)
    async function fetchAndDisplayKdsViewOrders() {
        if (!kdsOrdersList.querySelector('.kds-order-item') && !kdsOrdersList.querySelector('.error-message')) {
            kdsOrdersList.innerHTML = `<li class="no-orders">Carregando pedidos ativos...</li>`;
        }

        try {
            const [pendenteResponse, emPreparoResponse] = await Promise.all([
                fetch(`http://127.0.0.1:5000/api/kds/orders?status=Pendente`),
                fetch(`http://127.0.0.1:5000/api/kds/orders?status=Em Preparo`)
            ]);

            let pendenteOrders = [];
            let emPreparoOrders = [];

            if (pendenteResponse.ok) {
                pendenteOrders = await pendenteResponse.json();
            } else {
                console.error('Erro ao buscar Pedente:', pendenteResponse.status, pendenteResponse.statusText);
                // Optionally, handle partial failure, or fail all if one fails
            }

            if (emPreparoResponse.ok) {
                emPreparoOrders = await emPreparoResponse.json();
            } else {
                console.error('Erro ao buscar Em Preparo:', emPreparoResponse.status, emPreparoResponse.statusText);
                // Optionally, handle partial failure
            }
            
            // If both failed, show a general error
            if (!pendenteResponse.ok && !emPreparoResponse.ok) {
                 kdsOrdersList.innerHTML = `<li class="no-orders error-message">Erro ao carregar pedidos ativos. Tente novamente.</li>`;
                 return;
            }

            const combinedOrders = [...pendenteOrders, ...emPreparoOrders];
            // Sort by timestamp ascending (oldest first)
            combinedOrders.sort((a, b) => new Date(a.timestamp_iso) - new Date(b.timestamp_iso)); 

            displayOrders(combinedOrders, kdsOrdersList, displayedKdsOrderIds);

        } catch (error) {
            console.error(`Falha na requisição de pedidos para KDS View:`, error);
            kdsOrdersList.innerHTML = `<li class="no-orders error-message">Falha ao conectar com o servidor (KDS View).</li>`;
        }
    }


    function displayOrders(orders, targetListElement, displayedIdsSet) {
        if (!targetListElement) return;

        if (orders.length === 0) {
            if (targetListElement === kdsOrdersList) {
                targetListElement.innerHTML = `<li class="no-orders">Nenhum pedido pendente ou em preparo no momento.</li>`;
            } else if (targetListElement === finishedOrdersList) {
                targetListElement.innerHTML = `<li class="no-orders">Nenhum pedido finalizado no momento.</li>`;
            } else {
                targetListElement.innerHTML = `<li class="no-orders">Nenhum pedido no momento.</li>`;
            }
            displayedIdsSet.clear();
            return;
        }

        const newOrderIds = new Set();
        let newOrdersArrived = false;
        const fragment = document.createDocumentFragment();

        orders.forEach(order => {
            newOrderIds.add(order._id);
            if (!displayedIdsSet.has(order._id)) {
                newOrdersArrived = true;
            }

            const listItem = document.createElement('li');
            listItem.className = 'kds-order-item card';
            listItem.dataset.orderId = order._id;

            let itemsHtml = '<ul class="order-item-list">';
            order.items.forEach(item => {
                itemsHtml += `<li>${item.quantity}x ${item.name}</li>`;
            });
            itemsHtml += '</ul>';

            const orderTime = order.timestamp_iso 
                ? new Date(order.timestamp_iso).toLocaleTimeString('pt-BR', { 
                    hour: '2-digit', 
                    minute: '2-digit', 
                    timeZone: 'America/Sao_Paulo' 
                  }) 
                : 'N/A';

            let actionButtonsHtml = '';
            // Action buttons only for "Pendente" or "Em Preparo" statuses
            if (order.status === 'Pendente' || order.status === 'Em Preparo') {
                actionButtonsHtml = `
                    <button class="btn-kds-action btn-mark-preparando" data-id="${order._id}" ${order.status === 'Em Preparo' ? 'disabled' : ''}>Preparando</button>
                    <button class="btn-kds-action btn-mark-pronto" data-id="${order._id}">Pronto</button>
                `;
            } else if (order.status === 'Pronto') {
                // No buttons for "Pronto" orders in this example, but could add "Reabrir" here
            }


            listItem.innerHTML = `
                <div class="order-header">
                    <span class="order-id">Pedido #${order._id.slice(-6)}</span>
                    <span class="order-time"><i class="fas fa-clock"></i> ${orderTime}</span>
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
        
        targetListElement.innerHTML = ''; // Clear previous content
        targetListElement.appendChild(fragment);

        // Update the set of displayed order IDs for the specific list
        if (targetListElement === kdsOrdersList) displayedKdsOrderIds = newOrderIds;
        if (targetListElement === finishedOrdersList) displayedFinishedOrderIds = newOrderIds;


        // Play sound only for new orders arriving in the KDS view (Pendente/Em Preparo)
        if (newOrdersArrived && notificationSound && targetListElement === kdsOrdersList) {
            notificationSound.play().catch(e => console.warn("Erro ao tocar som de notificação:", e));
        }

        document.querySelectorAll(`#${targetListElement.id} .btn-mark-preparando`).forEach(button => {
            button.removeEventListener('click', handlePreparandoClick);
            button.addEventListener('click', handlePreparandoClick);
        });
        document.querySelectorAll(`#${targetListElement.id} .btn-mark-pronto`).forEach(button => {
            button.removeEventListener('click', handleProntoClick);
            button.addEventListener('click', handleProntoClick);
        });
    }
    
    function handlePreparandoClick(event) {
        handleOrderStatusUpdate(event.target.dataset.id, 'Em Preparo');
    }
    function handleProntoClick(event) {
        handleOrderStatusUpdate(event.target.dataset.id, 'Pronto');
    }

    async function handleOrderStatusUpdate(orderId, newStatus) {
        console.log(`Attempting to update order ${orderId} to status ${newStatus}`);
        const apiUrl = `http://127.0.0.1:5000/api/kds/order/${orderId}/status`;

        try {
            const response = await fetch(apiUrl, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus }),
            });

            const responseData = await response.json();

            if (response.ok) {
                console.log(`Order ${orderId} status updated to ${newStatus} successfully:`, responseData.message);
                
                // Refresh the KDS view (Pendente & Em Preparo)
                fetchAndDisplayKdsViewOrders();
                
                // Refresh the Finished Orders view if it's active or if an order was moved to/from Pronto
                if (activeTab === 'finished-orders-view' || newStatus === 'Pronto' || (orderId && displayedFinishedOrderIds.has(orderId) && newStatus !== 'Pronto')) {
                    fetchSingleStatusOrders('Pronto', finishedOrdersList, displayedFinishedOrderIds);
                }

            } else {
                console.error(`Error updating order ${orderId} status: ${response.status} ${response.statusText}`, responseData);
                alert(`Erro ao atualizar status do pedido: ${responseData.error || response.statusText}`);
            }
        } catch (error) {
            console.error(`Network or other error updating order ${orderId} status:`, error);
            alert('Erro de rede ao tentar atualizar o status do pedido. Verifique a conexão com o servidor.');
        }
    }

    function startPollingForActiveTab() {
        stopPolling(); 
        if (activeTab === 'kds-view') {
            fetchAndDisplayKdsViewOrders(); // Initial fetch
            pollingIntervalId = setInterval(fetchAndDisplayKdsViewOrders, POLLING_INTERVAL);
        } else if (activeTab === 'finished-orders-view') {
            fetchSingleStatusOrders('Pronto', finishedOrdersList, displayedFinishedOrderIds); // Initial fetch
            pollingIntervalId = setInterval(() => fetchSingleStatusOrders('Pronto', finishedOrdersList, displayedFinishedOrderIds), POLLING_INTERVAL);
        }
    }

    function stopPolling() {
        if (pollingIntervalId) {
            clearInterval(pollingIntervalId);
            pollingIntervalId = null;
        }
    }

    navTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetViewId = tab.dataset.target;
            activeTab = targetViewId; 

            document.querySelectorAll('.main-view').forEach(view => view.classList.remove('active-view'));
            navTabs.forEach(t => t.classList.remove('active'));

            const targetView = document.getElementById(targetViewId);
            if (targetView) {
                targetView.classList.add('active-view');
            }
            tab.classList.add('active');

            startPollingForActiveTab(); 

            if (targetViewId === 'admin-view') {
                fetchMenu(); 
            }
        });
    });

    const initiallyActiveTabButton = document.querySelector('.nav-tab.active');
    if (initiallyActiveTabButton) {
        activeTab = initiallyActiveTabButton.dataset.target;
    } else {
        // Fallback if no tab is marked active in HTML, default to kds-view
        activeTab = 'kds-view';
        document.getElementById('tab-kds')?.classList.add('active');
        document.getElementById('kds-view')?.classList.add('active-view');
    }
    startPollingForActiveTab();


    // --- Lógica de Gerenciamento de Cardápio ---
    const menuItemForm = document.getElementById('menu-item-form');
    const menuTableBody = document.getElementById('menu-table-body');
    const noMenuItemsRow = document.getElementById('no-menu-items-row');
    const editItemIdField = document.getElementById('edit-item-id');
    const itemNameField = document.getElementById('item-name');
    const itemPriceField = document.getElementById('item-price');
    const saveButton = document.getElementById('save-button');
    const cancelEditButton = document.getElementById('cancel-edit-button');
    const formMessage = document.getElementById('form-message');

    async function fetchMenu() {
        try {
            const response = await fetch('/menu');
            const menuData = await response.json();
            renderMenu(menuData.menu);
        } catch (error) {
            console.error("Erro ao buscar cardápio:", error);
            if (menuTableBody) menuTableBody.innerHTML = '<tr><td colspan="3">Erro ao carregar cardápio.</td></tr>';
        }
    }

    function renderMenu(menuItems) {
        if (!menuTableBody || !noMenuItemsRow) return;
        menuTableBody.innerHTML = ''; // Limpa a tabela

        if (!menuItems || menuItems.length === 0) {
            noMenuItemsRow.style.display = ''; // Mostra a mensagem "Nenhum item"
            return;
        }
        noMenuItemsRow.style.display = 'none'; // Esconde a mensagem

        menuItems.forEach(item => {
            const row = menuTableBody.insertRow();
            row.insertCell().textContent = item.name;
            row.insertCell().textContent = parseFloat(item.price).toFixed(2);

            const actionsCell = row.insertCell();
            const editButton = document.createElement('button');
            editButton.innerHTML = '<i class="fas fa-edit"></i> Editar';
            editButton.className = 'btn btn-edit';
            editButton.onclick = () => populateFormForEdit(item);
            actionsCell.appendChild(editButton);

            const deleteButton = document.createElement('button');
            deleteButton.innerHTML = '<i class="fas fa-trash"></i> Excluir';
            deleteButton.className = 'btn btn-delete';
            deleteButton.onclick = () => deleteMenuItem(item.name); // Supondo que o nome é único para exclusão
            actionsCell.appendChild(deleteButton);
        });
    }

    function populateFormForEdit(item) {
        editItemIdField.value = item.name; // Usando nome como ID para simplicidade, idealmente seria um ID único
        itemNameField.value = item.name;
        itemPriceField.value = parseFloat(item.price).toFixed(2);
        saveButton.innerHTML = '<i class="fas fa-save"></i> Salvar Alterações';
        cancelEditButton.style.display = 'inline-block';
        formMessage.textContent = '';
        itemNameField.focus();
    }

    function resetForm() {
        menuItemForm.reset();
        editItemIdField.value = '';
        saveButton.innerHTML = '<i class="fas fa-plus"></i> Adicionar Item';
        cancelEditButton.style.display = 'none';
        formMessage.textContent = '';
    }

    if (cancelEditButton) {
        cancelEditButton.addEventListener('click', resetForm);
    }

    if (menuItemForm) {
        menuItemForm.addEventListener('submit', async function(event) {
            event.preventDefault();
            formMessage.textContent = '';

            const name = itemNameField.value.trim();
            const priceStr = itemPriceField.value.trim().replace(',', '.');
            const price = parseFloat(priceStr);
            const id = editItemIdField.value;

            if (!name || isNaN(price) || price <= 0) {
                formMessage.textContent = 'Por favor, preencha nome e preço válido.';
                formMessage.className = 'admin-form-message error';
                return;
            }

            const itemData = { name, price: price.toFixed(2) };
            let url = '/menu';
            let method = 'POST';

            // Se id existe, estamos editando. A API de exemplo não suporta PUT/PATCH por ID.
            // Para uma edição real, a API precisaria de um endpoint tipo PUT /menu/item_id ou similar.
            // Por ora, a submissão sempre adiciona ou reescreve o cardápio inteiro.
            // Para simular edição, precisaríamos buscar o cardápio, modificar e reenviar tudo.
            // Isso é ineficiente. A API /menu como está, substitui o cardápio inteiro.

            // Para simplificar e usar a API existente:
            // Se for uma "edição", vamos buscar o cardápio, remover o item antigo (se existir), adicionar o novo/modificado, e enviar o cardápio completo.
            // Ou, se a API /menu aceitar um item e o adicionar/atualizar, seria mais simples.
            // Assumindo que a API /menu POST substitui tudo:
            
            try {
                // Para uma edição real, você faria um GET, modificaria o item na lista e faria um POST com a lista completa.
                // Para adicionar, apenas POST o novo item (se a API suportar adição incremental, senão, GET, ADD, POST).
                // A API /menu atual parece substituir o menu.json inteiro.
                
                // Vamos simplificar: se é edição, avisamos que a API atual não suporta bem.
                // Para adicionar, precisamos enviar o cardápio inteiro.
                // Esta parte é complexa devido à natureza da API /menu que substitui tudo.
                
                // Ação mais simples para o exemplo: sempre buscar, adicionar/modificar, e reenviar tudo.
                let currentMenuResponse = await fetch('/menu');
                let currentMenuData = await currentMenuResponse.json();
                let menuToSave = currentMenuData.menu || [];

                if (id) { // "Editando"
                    menuToSave = menuToSave.filter(item => item.name !== id); // Remove o antigo se o nome mudou
                    menuToSave = menuToSave.filter(item => item.name !== itemData.name); // Remove duplicata se nome não mudou
                }
                menuToSave.push(itemData);
                // Ordenar para consistência
                menuToSave.sort((a, b) => a.name.localeCompare(b.name));


                const response = await fetch(url, {
                    method: method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ menu: menuToSave }) // A API espera um objeto com a chave "menu"
                });

                if (response.ok) {
                    formMessage.textContent = `Item "${name}" ${id ? 'atualizado' : 'adicionado'} com sucesso!`;
                    formMessage.className = 'admin-form-message success';
                    resetForm();
                    fetchMenu(); // Recarrega a lista
                } else {
                    const errorData = await response.json();
                    formMessage.textContent = `Erro: ${errorData.error || response.statusText}`;
                    formMessage.className = 'admin-form-message error';
                }
            } catch (error) {
                console.error("Erro ao salvar item:", error);
                formMessage.textContent = 'Erro de conexão ao salvar o item.';
                formMessage.className = 'admin-form-message error';
            }
        });
    }

    // Carregar cardápio inicial se a aba admin estiver visível ou se for clicada
    // This section can be removed as its logic is now integrated into the Unified Tab Click Handler
    // and the Initial Tab State & Polling section.
    /*
    if (document.getElementById('tab-admin')) {
         // Se a aba admin for clicada, carrega o menu
        document.getElementById('tab-admin').addEventListener('click', () => {
            if (document.getElementById('admin-view').classList.contains('active-view')) {
                 fetchMenu();
            }
        });
        // Se a aba admin já estiver ativa no carregamento (improvável com KDS padrão)
        if (document.getElementById('admin-view').classList.contains('active-view')) {
            fetchMenu();
        }
    }
    */
});