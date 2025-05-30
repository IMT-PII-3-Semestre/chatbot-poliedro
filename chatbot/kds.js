document.addEventListener('DOMContentLoaded', () => {
    const kdsView = document.getElementById('kds-view');
    const kdsOrdersList = document.getElementById('kds-orders-list');
    const notificationSound = document.getElementById('notification-sound');
    const tabKds = document.getElementById('tab-kds');
    const tabAdmin = document.getElementById('tab-admin'); // Added for clarity if needed elsewhere
    const adminView = document.getElementById('admin-view'); // Added for clarity if needed elsewhere
    const navTabs = document.querySelectorAll('.nav-tab');


    let displayedOrderIds = new Set();
    let isKdsTabActive = true; // Assume KDS tab is active initially as per HTML
    let pollingIntervalId = null;
    const POLLING_INTERVAL = 15000; // 15 segundos

    // --- Funções do KDS (Pedidos Pendentes) ---
    async function fetchKDSOrders() {
        console.log("fetchKDSOrders CALLED. isKdsTabActive:", isKdsTabActive); // DEBUG
        if (!isKdsTabActive) {
            console.log("KDS tab not active, skipping fetch.");
            return;
        }
        if (!kdsOrdersList) {
            console.error("kdsOrdersList element not found in fetchKDSOrders!"); // DEBUG
            return;
        }
        kdsOrdersList.innerHTML = '<li class="no-orders">Carregando pedidos...</li>'; // Show loading message
        
        const apiUrl = 'http://127.0.0.1:5000/api/kds/orders'; // Use absolute URL with correct port
        console.log(`Attempting to fetch ${apiUrl}...`); // DEBUG
        
        try {
            const response = await fetch(apiUrl); // Use the apiUrl variable
            console.log("Fetch response status:", response.status); // DEBUG
            if (!response.ok) {
                console.error('Erro ao buscar pedidos KDS:', response.status, response.statusText);
                kdsOrdersList.innerHTML = '<li class="no-orders error-message">Erro ao carregar pedidos. Tente novamente.</li>';
                return;
            }
            const orders = await response.json();
            displayKDSOrders(orders);
        } catch (error) {
            console.error('Falha na requisição de pedidos KDS:', error);
            kdsOrdersList.innerHTML = '<li class="no-orders error-message">Falha ao conectar com o servidor.</li>';
        }
    }

    function displayKDSOrders(orders) {
        if (!kdsOrdersList) return;

        if (orders.length === 0) {
            kdsOrdersList.innerHTML = '<li class="no-orders">Nenhum pedido pendente no momento.</li>';
            displayedOrderIds.clear(); // Clear if no orders
            return;
        }

        const newOrderIds = new Set();
        let newOrdersArrived = false;

        // Build new list elements
        const fragment = document.createDocumentFragment();
        orders.forEach(order => {
            newOrderIds.add(order._id);
            if (!displayedOrderIds.has(order._id)) {
                newOrdersArrived = true;
            }

            const listItem = document.createElement('li');
            listItem.className = 'kds-order-item card'; // Assuming 'card' class for styling
            listItem.dataset.orderId = order._id;

            let itemsHtml = '<ul class="order-item-list">';
            order.items.forEach(item => {
                itemsHtml += `<li>${item.quantity}x ${item.name}</li>`;
            });
            itemsHtml += '</ul>';

            // Format time: HH:MM
            const orderTime = order.timestamp_iso ? new Date(order.timestamp_iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : 'N/A';

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
                    <div class="order-actions"> {/* Wrapper adicionado */}
                        <button class="btn-kds-action btn-mark-preparando" data-id="${order._id}">Preparando</button> {/* Texto do botão alterado */}
                        <button class="btn-kds-action btn-mark-pronto" data-id="${order._id}">Pronto</button> {/* Texto do botão alterado */}
                    </div>
                </div>
            `;
            fragment.appendChild(listItem);
        });
        
        kdsOrdersList.innerHTML = ''; // Clear previous content
        kdsOrdersList.appendChild(fragment);

        // Update the set of displayed order IDs
        displayedOrderIds = newOrderIds;

        if (newOrdersArrived && notificationSound) {
            notificationSound.play().catch(e => console.warn("Erro ao tocar som de notificação:", e));
        }

        // Add event listeners for action buttons (example)
        document.querySelectorAll('.btn-mark-preparando').forEach(button => {
            button.addEventListener('click', () => handleOrderStatusUpdate(button.dataset.id, 'Em Preparo'));
        });
        document.querySelectorAll('.btn-mark-pronto').forEach(button => {
            button.addEventListener('click', () => handleOrderStatusUpdate(button.dataset.id, 'Pronto'));
        });
    }

    async function handleOrderStatusUpdate(orderId, newStatus) {
        console.log(`Atualizar pedido ${orderId} para ${newStatus}`);
        // TODO: Implement API call to update order status
        // Ex: await fetch(`/api/orders/${orderId}/status`, { method: 'PUT', body: JSON.stringify({ status: newStatus }), headers: {'Content-Type': 'application/json'} });
        // After successful update, re-fetch orders:
        // fetchKDSOrders();
        alert(`Funcionalidade "Marcar ${newStatus}" para pedido ${orderId} ainda não implementada no backend.`);
    }


    function startKDSPolling() {
        if (pollingIntervalId) {
            clearInterval(pollingIntervalId);
        }
        fetchKDSOrders(); // Fetch immediately
        pollingIntervalId = setInterval(fetchKDSOrders, POLLING_INTERVAL);
        // console.log("KDS polling started.");
    }

    function stopKDSPolling() {
        if (pollingIntervalId) {
            clearInterval(pollingIntervalId);
            pollingIntervalId = null;
            // console.log("KDS polling stopped.");
        }
    }

    // --- Gerenciamento de Abas (simplificado, já que você tem um no kds.html) ---
    // Este código assume que a lógica de troca de abas no seu kds.html principal
    // já define qual view está ativa. Vamos nos basear no botão 'tab-kds'.

    // --- Initial Tab State & Polling ---
    if (tabKds && tabKds.classList.contains('active')) {
        isKdsTabActive = true;
        startKDSPolling();
    } else {
        isKdsTabActive = false;
        // If admin tab is active by default (it's not in the HTML, but for completeness)
        if (tabAdmin && tabAdmin.classList.contains('active')) {
            if (adminView && adminView.classList.contains('active-view')) { // Ensure view is also active
                fetchMenu();
            }
        }
    }

    // --- Unified Tab Click Handler ---
    navTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetViewId = tab.dataset.target;
            const targetView = document.getElementById(targetViewId);

            // Deactivate all views and tabs
            document.querySelectorAll('.main-view').forEach(view => view.classList.remove('active-view'));
            navTabs.forEach(t => t.classList.remove('active'));

            // Activate the clicked tab and its corresponding view
            if (targetView) {
                targetView.classList.add('active-view');
            }
            tab.classList.add('active');

            // Manage KDS polling and fetch menu for admin tab
            if (targetViewId === 'kds-view') {
                if (!isKdsTabActive) {
                    isKdsTabActive = true;
                    if (kdsOrdersList) kdsOrdersList.innerHTML = '<li class="no-orders">Carregando pedidos...</li>';
                    startKDSPolling();
                }
            } else { // Other tabs (e.g., admin-view)
                if (isKdsTabActive) {
                    isKdsTabActive = false;
                    stopKDSPolling();
                }
                if (targetViewId === 'admin-view') {
                    fetchMenu(); // Fetch menu when admin tab is activated
                }
            }
        });
    });


    // --- Lógica de Gerenciamento de Cardápio (placeholder, já que o foco é KDS) ---
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