document.addEventListener('DOMContentLoaded', () => {
    // --- Elementos KDS ---
    const orderListContainer = document.getElementById('order-list');
    const noOrdersMessage = document.getElementById('no-orders-message');
    const notificationSound = document.getElementById('notification-sound');
    const toggleSoundButton = document.getElementById('toggle-sound');
    const soundIcon = toggleSoundButton.querySelector('i');

    // --- Elementos Admin ---
    const kdsView = document.getElementById('kds-view');
    const adminView = document.getElementById('admin-view');
    const tabKds = document.getElementById('tab-kds');
    const tabAdmin = document.getElementById('tab-admin');
    const menuItemForm = document.getElementById('menu-item-form');
    const itemNameInput = document.getElementById('item-name');
    const itemPriceInput = document.getElementById('item-price');
    const editItemIdInput = document.getElementById('edit-item-id');
    const saveButton = document.getElementById('save-button');
    const cancelEditButton = document.getElementById('cancel-edit-button');
    const menuTableBody = document.getElementById('menu-table-body');
    const noMenuItemsRow = document.getElementById('no-menu-items-row');
    const formMessage = document.getElementById('form-message');

    // --- Chaves do Storage ---
    const KDS_STORAGE_KEY = 'pedidosCozinhaPendentes'; // Pedidos KDS
    const MENU_STORAGE_KEY = 'restauranteMenu'; // Itens do Cardápio

    // --- Variáveis de Estado ---
    let soundEnabled = true;
    let currentlyDisplayedOrderIds = new Set();
    let menuItems = []; // Array para guardar itens do cardápio {id, name, price}

    // ========================================================================
    // Funções KDS (Pedidos Pendentes)
    // ========================================================================

    function formatTimestamp(isoTimestamp) {
        try {
            const date = new Date(isoTimestamp);
            const hours = date.getHours().toString().padStart(2, '0');
            const minutes = date.getMinutes().toString().padStart(2, '0');
            return `${hours}:${minutes}`;
        } catch (e) {
            console.error("Erro ao formatar timestamp:", e);
            return '';
        }
    }

    function playNotificationSound() {
        if (soundEnabled && notificationSound) {
            notificationSound.play().catch(error => {
                console.warn("Não foi possível tocar o som de notificação:", error.message);
            });
        }
    }

    function createOrderCard(order, isNew = false) {
        const card = document.createElement('div');
        card.classList.add('order-card');
        card.dataset.orderId = order.id;

        if (isNew) {
            card.classList.add('new');
            setTimeout(() => card.classList.remove('new'), 1600);
        }

        const itemsHtml = order.items.map(item => `<li>${item.nome}</li>`).join('');
        const formattedTime = formatTimestamp(order.timestamp);

        card.innerHTML = `
            <h2>Pedido <span class="order-id">#${order.id}</span></h2>
            <ul class="items-list">
                ${itemsHtml}
            </ul>
            <span class="timestamp">${formattedTime}</span>
            <button class="complete-button">
                <i class="fas fa-check-circle"></i> Concluir Pedido
            </button>
        `;

        const completeButton = card.querySelector('.complete-button');
        completeButton.addEventListener('click', () => completeOrder(order.id));

        return card;
    }

    function renderOrders() {
        const pendingOrders = JSON.parse(localStorage.getItem(KDS_STORAGE_KEY) || '[]');
        const newDisplayedOrderIds = new Set();
        let hasNewOrders = false;

        orderListContainer.querySelectorAll('.order-card').forEach(card => card.remove());

        if (pendingOrders.length === 0) {
            noOrdersMessage.style.display = 'block';
            currentlyDisplayedOrderIds.clear();
        } else {
            noOrdersMessage.style.display = 'none';

            pendingOrders.forEach(order => {
                const orderId = order.id;
                newDisplayedOrderIds.add(orderId);
                const isNew = !currentlyDisplayedOrderIds.has(orderId);
                if (isNew) hasNewOrders = true;
                const cardElement = createOrderCard(order, isNew);
                orderListContainer.appendChild(cardElement);
            });

            currentlyDisplayedOrderIds = newDisplayedOrderIds;
            if (hasNewOrders) playNotificationSound();
        }
    }

    function completeOrder(orderId) {
        console.log(`Concluindo pedido ${orderId}`);
        const cardToRemove = orderListContainer.querySelector(`.order-card[data-order-id="${orderId}"]`);
        if (cardToRemove) {
            cardToRemove.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
            cardToRemove.style.opacity = '0';
            cardToRemove.style.transform = 'scale(0.95)';
            setTimeout(() => cardToRemove.remove(), 300);
        }

        let pendingOrders = JSON.parse(localStorage.getItem(KDS_STORAGE_KEY) || '[]');
        pendingOrders = pendingOrders.filter(order => order.id !== orderId);
        localStorage.setItem(KDS_STORAGE_KEY, JSON.stringify(pendingOrders));
        currentlyDisplayedOrderIds.delete(orderId);

        if (pendingOrders.length === 0) {
            setTimeout(() => {
                if (orderListContainer.querySelectorAll('.order-card').length === 0) {
                    noOrdersMessage.style.display = 'block';
                }
            }, 310);
        }
    }

    function toggleSound() {
        soundEnabled = !soundEnabled;
        soundIcon.className = soundEnabled ? 'fas fa-volume-high' : 'fas fa-volume-mute';
        toggleSoundButton.style.borderColor = soundEnabled ? 'white' : '#aaa';
        console.log(`Som ${soundEnabled ? 'ativado' : 'desativado'}`);
        if (soundEnabled) playNotificationSound();
    }

    // ========================================================================
    // Funções Admin (Gerenciar Cardápio)
    // ========================================================================

    /**
     * Alterna entre as visões KDS e Admin.
     * @param {string} targetViewId - O ID da visão a ser mostrada ('kds-view' ou 'admin-view').
     */
    function switchView(targetViewId) {
        const views = [kdsView, adminView];
        const tabs = [tabKds, tabAdmin];

        views.forEach(view => {
            if (view.id === targetViewId) {
                view.classList.add('active-view');
                view.style.display = ''; // Usa display padrão (block ou grid)
            } else {
                view.classList.remove('active-view');
                view.style.display = 'none';
            }
        });

        tabs.forEach(tab => {
            if (tab.dataset.target === targetViewId) {
                tab.classList.add('active');
            } else {
                tab.classList.remove('active');
            }
        });
        console.log(`Alternado para visão: ${targetViewId}`);
    }

    /**
     * Carrega os itens do cardápio do localStorage.
     */
    function loadMenu() {
        const storedMenu = localStorage.getItem(MENU_STORAGE_KEY);
        menuItems = storedMenu ? JSON.parse(storedMenu) : [];
        console.log("Menu carregado:", menuItems);
    }

    /**
     * Salva o array menuItems atual no localStorage.
     */
    function saveMenu() {
        localStorage.setItem(MENU_STORAGE_KEY, JSON.stringify(menuItems));
        console.log("Menu salvo:", menuItems);
        // Talvez notificar o lado do chatbot se necessário em uma configuração mais complexa
    }

    /**
     * Renderiza os itens do cardápio na tabela de administração.
     */
    function renderMenuTable() {
        menuTableBody.innerHTML = ''; // Limpa linhas existentes

        if (menuItems.length === 0) {
            noMenuItemsRow.style.display = ''; // Mostra a linha de mensagem 'sem itens'
        } else {
            noMenuItemsRow.style.display = 'none'; // Esconde a linha de mensagem 'sem itens'
            menuItems.forEach(item => {
                const row = document.createElement('tr');
                row.dataset.itemId = item.id;
                row.innerHTML = `
                    <td>${escapeHtml(item.name)}</td>
                    <td>R$ ${parseFloat(item.price).toFixed(2)}</td>
                    <td>
                        <div class="action-buttons">
                            <button class="btn btn-warning edit-btn" title="Editar">
                                <i class="fas fa-pencil-alt"></i>
                            </button>
                            <button class="btn btn-danger delete-btn" title="Excluir">
                                <i class="fas fa-trash-alt"></i>
                            </button>
                        </div>
                    </td>
                `;
                menuTableBody.appendChild(row);
            });
        }
    }

    /**
     * Lida com o envio do formulário para adicionar ou editar um item do cardápio.
     * @param {Event} event - O evento de envio do formulário.
     */
    function handleFormSubmit(event) {
        event.preventDefault();
        const name = itemNameInput.value.trim();
        const price = parseFloat(itemPriceInput.value);
        const editingId = editItemIdInput.value;

        if (!name || isNaN(price) || price < 0) {
            showFormMessage("Por favor, preencha o nome e um preço válido.", 'error');
            return;
        }

        if (editingId) {
            // Editando item existente
            const itemIndex = menuItems.findIndex(item => item.id === editingId);
            if (itemIndex > -1) {
                menuItems[itemIndex].name = name;
                menuItems[itemIndex].price = price;
                showFormMessage("Item atualizado com sucesso!", 'success');
            }
        } else {
            // Adicionando novo item
            const newItem = {
                id: `menu_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`, // ID único simples
                name: name,
                price: price
            };
            menuItems.push(newItem);
            showFormMessage("Item adicionado com sucesso!", 'success');
        }

        saveMenu();
        renderMenuTable();
        resetForm();
    }

    /**
     * Lida com cliques no botão Editar na tabela do cardápio.
     * @param {string} itemId - O ID do item a ser editado.
     */
    function handleEditItem(itemId) {
        const itemToEdit = menuItems.find(item => item.id === itemId);
        if (itemToEdit) {
            editItemIdInput.value = itemToEdit.id;
            itemNameInput.value = itemToEdit.name;
            itemPriceInput.value = itemToEdit.price.toFixed(2);
            saveButton.innerHTML = '<i class="fas fa-save"></i> Salvar Alterações';
            cancelEditButton.style.display = 'inline-flex';
            itemNameInput.focus();
            showFormMessage(''); // Limpa mensagens anteriores
        }
    }

    /**
     * Lida com cliques no botão Excluir na tabela do cardápio.
     * @param {string} itemId - O ID do item a ser excluído.
     */
    function handleDeleteItem(itemId) {
        const itemToDelete = menuItems.find(item => item.id === itemId);
        if (itemToDelete && confirm(`Tem certeza que deseja excluir o item "${itemToDelete.name}"?`)) {
            menuItems = menuItems.filter(item => item.id !== itemId);
            saveMenu();
            renderMenuTable();
            // Reseta o formulário se o item excluído estava sendo editado
            if (editItemIdInput.value === itemId) {
                resetForm();
            }
            showFormMessage("Item excluído com sucesso.", 'success'); // Mostra mensagem na área do formulário
        }
    }

    /**
     * Reseta o formulário de item do cardápio para o estado inicial (para adicionar).
     */
    function resetForm() {
        menuItemForm.reset(); // Limpa campos de input
        editItemIdInput.value = ''; // Limpa ID oculto
        saveButton.innerHTML = '<i class="fas fa-plus"></i> Adicionar Item';
        cancelEditButton.style.display = 'none';
        // showFormMessage(''); // Opcionalmente limpa a mensagem ao resetar
    }

    /**
     * Exibe uma mensagem abaixo do formulário.
     * @param {string} message - O texto da mensagem.
     * @param {'success'|'error'|''} type - O tipo de mensagem para estilização.
     */
    function showFormMessage(message, type = '') {
        formMessage.textContent = message;
        formMessage.className = 'admin-form-message'; // Reseta classes
        if (type) {
            formMessage.classList.add(type);
        }
        // Esconde automaticamente mensagens de sucesso após um tempo
        if (type === 'success') {
            setTimeout(() => {
                if (formMessage.classList.contains('success')) { // Verifica se ainda é a mesma mensagem
                    showFormMessage('');
                }
            }, 3000);
        }
    }

    /** Escapamento básico de HTML */
    function escapeHtml(unsafe) {
        if (!unsafe) return '';
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // ========================================================================
    // Event Listeners
    // ========================================================================

    // Alternância de Som KDS
    toggleSoundButton.addEventListener('click', toggleSound);

    // Listener do Storage KDS (para atualizações de outras abas)
    window.addEventListener('storage', (event) => {
        if (event.key === KDS_STORAGE_KEY) {
            console.log("Detectada mudança no localStorage para pedidos (KDS).");
            setTimeout(renderOrders, 100); // Re-renderiza pedidos KDS
        }
        // Opcional: Adicionar listener para MENU_STORAGE_KEY se necessário,
        // embora geralmente apenas esta aba admin o modifique.
        // if (event.key === MENU_STORAGE_KEY) {
        //     console.log("Detectada mudança no localStorage para cardápio.");
        //     loadMenu();
        //     renderMenuTable();
        // }
    });

    // Alternância de Abas
    tabKds.addEventListener('click', () => switchView('kds-view'));
    tabAdmin.addEventListener('click', () => switchView('admin-view'));

    // Submissão do Formulário Admin
    menuItemForm.addEventListener('submit', handleFormSubmit);

    // Botão Cancelar Edição Admin
    cancelEditButton.addEventListener('click', resetForm);

    // Ações da Tabela Admin (Delegação de Eventos)
    menuTableBody.addEventListener('click', (event) => {
        const target = event.target;
        const editButton = target.closest('.edit-btn');
        const deleteButton = target.closest('.delete-btn');

        if (editButton) {
            const row = editButton.closest('tr');
            if (row && row.dataset.itemId) {
                handleEditItem(row.dataset.itemId);
            }
        } else if (deleteButton) {
            const row = deleteButton.closest('tr');
            if (row && row.dataset.itemId) {
                handleDeleteItem(row.dataset.itemId);
            }
        }
    });

    // ========================================================================
    // Inicialização
    // ========================================================================
    loadMenu();         // Carrega dados do cardápio primeiro
    renderMenuTable();  // Renderiza a tabela do cardápio
    renderOrders();     // Renderiza os pedidos KDS
    switchView('kds-view'); // Começa na visão KDS por padrão

}); // Fim DOMContentLoaded