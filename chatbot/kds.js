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
    const FLASK_API_BASE_URL = 'http://127.0.0.1:5000'; // Define base URL

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
        
        const apiUrl = `${FLASK_API_BASE_URL}/api/kds/orders?status=${status}`; // Use base URL
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
                fetch(`${FLASK_API_BASE_URL}/api/kds/orders?status=Pendente`), // Use base URL
                fetch(`${FLASK_API_BASE_URL}/api/kds/orders?status=Em Preparo`) // Use base URL
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

            let orderDateTimeFormatted;
            if (order.timestamp_iso) {
                const dateObj = new Date(order.timestamp_iso);
                const timeOptions = { 
                    hour: '2-digit', 
                    minute: '2-digit', 
                    timeZone: 'America/Sao_Paulo' 
                };
                // Check if the target list is for finished orders
                if (targetListElement === finishedOrdersList) {
                    const dateOptions = {
                        day: '2-digit',
                        month: '2-digit',
                        // year: 'numeric', // Optionally add year
                        timeZone: 'America/Sao_Paulo'
                    };
                    orderDateTimeFormatted = `${dateObj.toLocaleDateString('pt-BR', dateOptions)} ${dateObj.toLocaleTimeString('pt-BR', timeOptions)}`;
                } else {
                    orderDateTimeFormatted = dateObj.toLocaleTimeString('pt-BR', timeOptions);
                }
            } else {
                orderDateTimeFormatted = 'N/A';
            }


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
        const apiUrl = `${FLASK_API_BASE_URL}/api/kds/order/${orderId}/status`; // Use base URL

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
    const editItemIdField = document.getElementById('edit-item-id'); // Hidden field for ID
    const itemNameField = document.getElementById('item-name');
    const itemPriceField = document.getElementById('item-price');
    const saveButton = document.getElementById('save-button');
    const cancelEditButton = document.getElementById('cancel-edit-button');
    const formMessage = document.getElementById('form-message');

    async function fetchMenu() {
        if (!menuTableBody) return; // Ensure admin view elements are present
        try {
            formMessage.textContent = 'Carregando cardápio...';
            formMessage.className = 'admin-form-message';
            const response = await fetch(`${FLASK_API_BASE_URL}/menu`); // Use base URL
            if (!response.ok) {
                throw new Error(`Erro HTTP: ${response.status}`);
            }
            const data = await response.json();
            renderMenu(data.menu || []); // data.menu should be the array of items
            formMessage.textContent = '';
        } catch (error) {
            console.error("Erro ao buscar cardápio:", error);
            renderMenu([]); // Render an empty menu on error
            formMessage.textContent = 'Erro ao carregar o cardápio.';
            formMessage.className = 'admin-form-message error';
        }
    }

    function renderMenu(menuItems) {
        if (!menuTableBody || !noMenuItemsRow) return;
        menuTableBody.innerHTML = ''; 

        if (!menuItems || menuItems.length === 0) {
            noMenuItemsRow.style.display = ''; 
            return;
        }
        noMenuItemsRow.style.display = 'none'; 

        menuItems.forEach(item => {
            const row = menuTableBody.insertRow();
            row.insertCell().textContent = item.name;
            // Ensure price is a number and format it; backend sends it as string
            row.insertCell().textContent = parseFloat(item.price).toFixed(2); 

            const actionsCell = row.insertCell();
            actionsCell.className = 'action-buttons'; // For styling

            const editButton = document.createElement('button');
            editButton.innerHTML = '<i class="fas fa-edit"></i> Editar';
            editButton.className = 'btn btn-edit';
            editButton.onclick = () => populateFormForEdit(item); // item.id is the MongoDB _id
            actionsCell.appendChild(editButton);

            const deleteButton = document.createElement('button');
            deleteButton.innerHTML = '<i class="fas fa-trash"></i> Excluir';
            deleteButton.className = 'btn btn-danger';
            deleteButton.onclick = () => deleteMenuItem(item.id); // Use item.id (MongoDB _id)
            actionsCell.appendChild(deleteButton);
        });
    }

    function populateFormForEdit(item) {
        editItemIdField.value = item.id; // Store MongoDB _id here
        itemNameField.value = item.name;
        itemPriceField.value = parseFloat(item.price).toFixed(2);
        saveButton.innerHTML = '<i class="fas fa-save"></i> Salvar Alterações';
        saveButton.classList.remove('btn-primary');
        saveButton.classList.add('btn-success'); // Optional: change button color for edit
        cancelEditButton.style.display = 'inline-block';
        formMessage.textContent = '';
        itemNameField.focus();
    }

    function resetForm() {
        menuItemForm.reset();
        editItemIdField.value = ''; // Clear the hidden ID field
        saveButton.innerHTML = '<i class="fas fa-plus"></i> Adicionar Item';
        saveButton.classList.remove('btn-success');
        saveButton.classList.add('btn-primary');
        cancelEditButton.style.display = 'none';
        formMessage.textContent = '';
    }

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
            const response = await fetch(`${FLASK_API_BASE_URL}/api/menu/items/${itemId}`, { method: 'DELETE' }); // Use base URL
            const responseData = await response.json();

            if (response.ok) {
                formMessage.textContent = responseData.message || 'Item excluído com sucesso!';
                formMessage.className = 'admin-form-message success';
                fetchMenu(); // Recarrega a lista
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


    if (cancelEditButton) {
        cancelEditButton.addEventListener('click', resetForm);
    }

    if (menuItemForm) {
        menuItemForm.addEventListener('submit', async function(event) {
            event.preventDefault();
            formMessage.textContent = '';

            const name = itemNameField.value.trim();
            const priceStr = itemPriceField.value.trim().replace(',', '.');
            const editingItemId = editItemIdField.value; // Get ID if editing

            if (!name || priceStr === '' || isNaN(parseFloat(priceStr)) || parseFloat(priceStr) < 0) {
                formMessage.textContent = 'Por favor, preencha nome e preço válido (maior ou igual a zero).';
                formMessage.className = 'admin-form-message error';
                return;
            }
            const price = parseFloat(priceStr).toFixed(2);

            try {
                formMessage.textContent = 'Salvando cardápio...';
                formMessage.className = 'admin-form-message';

                // 1. Fetch current menu
                const currentMenuResponse = await fetch(`${FLASK_API_BASE_URL}/menu`); // Use base URL
                if (!currentMenuResponse.ok) throw new Error('Falha ao buscar cardápio atual para salvar.');
                const currentMenuData = await currentMenuResponse.json();
                let menuToSave = currentMenuData.menu || [];

                if (editingItemId) { // Editing existing item
                    const itemIndex = menuToSave.findIndex(item => item.id === editingItemId);
                    if (itemIndex > -1) {
                        menuToSave[itemIndex] = { ...menuToSave[itemIndex], name, price };
                    } else {
                        // Item not found, could be an error or treat as new (though less likely with _id)
                        // For safety, let's add if not found, though this path shouldn't be common if ID is correct
                        menuToSave.push({ name, price }); 
                    }
                } else { // Adding new item
                    // Check if item with the same name already exists (optional, good for UX)
                    if (menuToSave.some(item => item.name.toLowerCase() === name.toLowerCase())) {
                        if (!confirm(`Um item com o nome "${name}" já existe. Deseja substituí-lo/atualizá-lo?`)) {
                            formMessage.textContent = 'Operação cancelada.';
                            formMessage.className = 'admin-form-message';
                            return;
                        }
                        // If confirmed, remove existing to replace
                        menuToSave = menuToSave.filter(item => item.name.toLowerCase() !== name.toLowerCase());
                    }
                    menuToSave.push({ name, price }); // Add the new item
                }
                
                // Sort for consistency (optional)
                menuToSave.sort((a, b) => a.name.localeCompare(b.name));

                // 2. POST the entire updated menu
                const response = await fetch(`${FLASK_API_BASE_URL}/menu`, { // Use base URL
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ menu: menuToSave }) 
                });
                const responseData = await response.json();

                if (response.ok) {
                    formMessage.textContent = responseData.message || `Cardápio ${editingItemId ? 'atualizado' : 'salvo'} com sucesso!`;
                    formMessage.className = 'admin-form-message success';
                    resetForm();
                    fetchMenu(); 
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