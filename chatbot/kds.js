document.addEventListener('DOMContentLoaded', () => {
    // --- Elementos DOM ---
    const kdsOrdersList = document.getElementById('kds-orders-list');
    const adminMenuTableBody = document.getElementById('menu-table-body');
    const adminMenuForm = document.getElementById('menu-item-form');
    const itemIdInput = document.getElementById('edit-item-id'); // Input oculto para ID do item em edição
    const itemNameInput = document.getElementById('item-name');
    const itemPriceInput = document.getElementById('item-price');
    const saveButton = document.getElementById('save-button'); // Botão de salvar/adicionar
    const cancelEditButton = document.getElementById('cancel-edit-button');
    const formMessage = document.getElementById('form-message'); // Elemento para mensagens do formulário
    const noMenuItemsRow = document.getElementById('no-menu-items-row'); // Linha da tabela para "nenhum item"
    const notificationSound = document.getElementById('notification-sound'); // Áudio

    // Abas e Views
    const tabs = document.querySelectorAll('.nav-tab');
    const views = document.querySelectorAll('.main-view');

    // --- Chaves de Armazenamento e API ---
    const KDS_STORAGE_KEY = 'pedidosCozinhaPendentes';
    const API_MENU_URL = 'http://127.0.0.1:5000/menu'; // URL do endpoint do cardápio

    // --- Variáveis de Estado ---
    let editingItemId = null; // ID do item sendo editado (null se adicionando)
    let menuItems = []; // Cache local dos itens do cardápio [{id, name, price}]

    // --- Funções Auxiliares ---

    /** Escapa caracteres HTML para prevenir XSS simples */
    function escapeHtml(unsafe) {
        if (typeof unsafe !== 'string') return unsafe;
        return unsafe
             .replace(/&/g, "&amp;")
             .replace(/</g, "&lt;")
             .replace(/>/g, "&gt;")
             .replace(/"/g, "&quot;")
             .replace(/'/g, "&#039;");
    }

    /** Exibe uma mensagem temporária na área do formulário */
    function showFormMessage(message, type = 'info') { // tipos: 'info', 'success', 'error'
        if (!formMessage) {
            console.warn("Elemento #form-message não encontrado.");
            alert(message); // Fallback
            return;
        }
        formMessage.textContent = message;
        formMessage.className = `admin-form-message ${type}`;
        formMessage.style.display = 'block';
        setTimeout(() => {
            if (formMessage) formMessage.style.display = 'none';
        }, 4000); // Esconde após 4 segundos
    }

    /** Formata um timestamp ISO para HH:MM */
    function formatTimestamp(isoString) {
        if (!isoString) return '--:--';
        try {
            return new Date(isoString).toLocaleTimeString('pt-BR', {
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch (e) {
            console.error("Erro ao formatar timestamp:", isoString, e);
            return '--:--';
        }
    }

    /** Toca o som de notificação */
    function playNotificationSound() {
        if (notificationSound) {
            notificationSound.play().catch(error => console.warn("Não foi possível tocar som de notificação:", error));
        }
    }

    // ========================================================================
    // Funções KDS (Visualização de Pedidos)
    // ========================================================================

    /** Renderiza a lista de pedidos pendentes do localStorage */
    function renderOrders() {
        if (!kdsOrdersList) {
            console.error("Elemento da lista KDS (#kds-orders-list) não encontrado!");
            return;
        }
        kdsOrdersList.innerHTML = ''; // Limpa antes de renderizar

        try {
            const storedOrders = localStorage.getItem(KDS_STORAGE_KEY);
            const orders = JSON.parse(storedOrders || '[]');

            if (orders.length === 0) {
                kdsOrdersList.innerHTML = '<li class="no-orders">Nenhum pedido pendente.</li>';
                return;
            }

            orders.forEach(order => {
                if (!order || !order.id || !order.items) {
                     console.warn("Ignorando pedido mal formatado no KDS:", order);
                     return; // Pula este pedido
                }

                const li = document.createElement('li');
                li.classList.add('kds-order-item');
                li.dataset.id = order.id; // Adiciona ID para referência

                const timestamp = formatTimestamp(order.timestamp);
                const orderNumber = order.id.split('-')[1] || order.id; // Pega parte aleatória do ID

                // Mapeia itens para string HTML, tratando quantidade
                const itemsString = order.items.map(item =>
                    `${escapeHtml(item.quantity || 1)}x ${escapeHtml(item.name)}`
                ).join('<br>');

                // Formata o total se existir
                const totalString = (order.total !== null && !isNaN(order.total))
                    ? ` | Total: R$ ${parseFloat(order.total).toFixed(2).replace('.', ',')}`
                    : '';

                li.innerHTML = `
                    <div class="order-header">
                        <strong>Pedido #${orderNumber}</strong>
                        <span class="order-time">(${timestamp})</span>
                    </div>
                    <div class="order-items">${itemsString || '<i>Itens não especificados</i>'}</div>
                    <div class="order-footer">
                        <span>Status: ${escapeHtml(order.status || 'Pendente')}${totalString}</span>
                        <div class="kds-buttons-group">
                            <button class="kds-button complete-button" data-action="complete" title="Marcar como Concluído">
                                <i class="fas fa-check"></i> Concluir
                            </button>
                            <button class="kds-button cancel-button" data-action="cancel" title="Cancelar Pedido">
                                <i class="fas fa-times"></i> Cancelar
                            </button>
                        </div>
                    </div>
                `;
                kdsOrdersList.appendChild(li);
            });

        } catch (e) {
            console.error("Erro ao renderizar pedidos do KDS:", e);
            kdsOrdersList.innerHTML = '<li class="no-orders error">Erro ao carregar pedidos. Verifique o console.</li>';
        }
    }

    /** Atualiza o estado de um pedido no localStorage (Concluído ou Cancelado) */
    function updateOrderState(orderId, action) { // action: 'complete' ou 'cancel'
        if (!orderId || !action) return;

        try {
            let pendingOrders = JSON.parse(localStorage.getItem(KDS_STORAGE_KEY) || '[]');
            const updatedOrders = pendingOrders.filter(order => order.id !== orderId); // Remove o pedido

            if (updatedOrders.length !== pendingOrders.length) {
                localStorage.setItem(KDS_STORAGE_KEY, JSON.stringify(updatedOrders));
                console.log(`Pedido ${orderId} ${action === 'complete' ? 'concluído' : 'cancelado'} e removido da lista.`);
                renderOrders(); // Re-renderiza a lista KDS
                // Opcional: Mover para outra lista (concluídos/cancelados) em vez de apenas remover
            } else {
                console.warn(`Pedido ${orderId} não encontrado para ${action}.`);
            }
        } catch (e) {
            console.error(`Erro ao ${action} pedido ${orderId}:`, e);
        }
    }

    /** Lida com cliques nos botões Concluir/Cancelar do KDS */
    function handleKdsButtonClick(event) {
        const button = event.target.closest('.kds-button');
        if (!button) return; // Não clicou em um botão

        const action = button.dataset.action; // 'complete' ou 'cancel'
        const orderItem = button.closest('.kds-order-item');
        const orderId = orderItem?.dataset.id;

        if (orderId && (action === 'complete' || action === 'cancel')) {
            updateOrderState(orderId, action);
        }
    }


    // ========================================================================
    // Funções Admin (Gerenciar Cardápio)
    // ========================================================================

    /** Busca o cardápio atual do backend */
    async function loadMenuFromAPI() {
        try {
            const response = await fetch(API_MENU_URL); // GET por padrão
            if (!response.ok) {
                let errorMsg = `Erro HTTP ${response.status}`;
                try {
                    const errorData = await response.json();
                    errorMsg += `: ${errorData.error || response.statusText}`;
                } catch { /* Ignora erro no parse do erro */ }
                throw new Error(errorMsg);
            }
            const data = await response.json();
            // Garante que é um array e que 'price' é número
            menuItems = (Array.isArray(data) ? data : []).map(item => ({
                ...item,
                price: parseFloat(item.price) || 0 // Converte preço para número
            }));
        } catch (error) {
            console.error("Admin: Erro ao carregar cardápio da API:", error);
            showFormMessage(`Falha ao carregar o cardápio: ${error.message}`, 'error');
            menuItems = []; // Limpa cache local em caso de erro
        } finally {
             renderMenuTable(); // Renderiza a tabela (com dados ou vazia)
        }
    }

    /** Renderiza a tabela de itens do cardápio */
    function renderMenuTable() {
        if (!adminMenuTableBody) {
            console.error("Elemento #menu-table-body não encontrado!");
            return;
        }
        adminMenuTableBody.innerHTML = ''; // Limpa tabela

        if (menuItems.length === 0) {
            if (noMenuItemsRow) noMenuItemsRow.style.display = 'table-row';
        } else {
            if (noMenuItemsRow) noMenuItemsRow.style.display = 'none';
            menuItems.forEach(item => {
                if (!item || !item.id) return; // Pula itens inválidos
                const row = document.createElement('tr');
                row.dataset.itemId = item.id; // Adiciona ID à linha para referência
                row.innerHTML = `
                    <td>${escapeHtml(item.name)}</td>
                    <td>R$ ${(item.price || 0).toFixed(2).replace('.', ',')}</td>
                    <td>
                        <div class="action-buttons">
                            <button class="btn btn-warning edit-btn" data-id="${escapeHtml(item.id)}" title="Editar">
                                <i class="fas fa-pencil-alt"></i>
                            </button>
                            <button class="btn btn-danger delete-btn" data-id="${escapeHtml(item.id)}" title="Excluir">
                                <i class="fas fa-trash-alt"></i>
                            </button>
                        </div>
                    </td>
                `;
                adminMenuTableBody.appendChild(row);
            });
        }
        // Reanexa listeners aos botões (importante após re-renderizar)
        attachTableButtonListeners();
    }

    /** Anexa listeners aos botões de Editar/Excluir na tabela */
    function attachTableButtonListeners() {
        document.querySelectorAll('#menu-table-body .edit-btn').forEach(button => {
            button.removeEventListener('click', handleEditClick); // Evita duplicatas
            button.addEventListener('click', handleEditClick);
        });
        document.querySelectorAll('#menu-table-body .delete-btn').forEach(button => {
            button.removeEventListener('click', handleDeleteClick); // Evita duplicatas
            button.addEventListener('click', handleDeleteClick);
        });
    }

    /** Envia o cardápio atualizado para o backend */
    async function updateMenuOnBackend() {
        try {
            const response = await fetch(API_MENU_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                // Envia o array 'menuItems' local, garantindo que price seja número
                body: JSON.stringify(menuItems.map(item => ({...item, price: parseFloat(item.price) || 0})))
            });

            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.error || `Erro HTTP ${response.status}`);
            }
            return true; // Indica sucesso
        } catch (error) {
            console.error("Admin: Erro ao enviar atualização do cardápio:", error);
            showFormMessage(`Falha ao salvar cardápio no servidor: ${error.message}.`, 'error');
            return false; // Indica falha
        }
    }

    /** Lida com o submit do formulário (Adicionar ou Salvar Edição) */
    async function handleFormSubmit(event) {
        event.preventDefault();
        const name = itemNameInput.value.trim();
        const priceInput = itemPriceInput.value.replace(',', '.'); // Aceita vírgula
        const price = parseFloat(priceInput);

        if (!name || isNaN(price) || price < 0) {
            showFormMessage("Por favor, preencha nome e preço válido (maior ou igual a zero).", 'error');
            return;
        }

        let message = "";
        let success = false;
        const currentEditingId = editingItemId; // Captura antes de modificar

        if (currentEditingId) {
            // Editando
            const itemIndex = menuItems.findIndex(item => item.id === currentEditingId);
            if (itemIndex > -1) {
                menuItems[itemIndex].name = name;
                menuItems[itemIndex].price = price;
                message = "Item atualizado com sucesso!";
                success = true;
            } else {
                message = "Erro: Item a ser editado não encontrado.";
                success = false;
            }
        } else {
            // Adicionando
            const newItem = {
                // ID gerado no frontend para simplificar, idealmente seria gerado no backend
                id: `item_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
                name: name,
                price: price
            };
            menuItems.push(newItem);
            message = "Novo item adicionado com sucesso!";
            success = true;
        }

        if (success) {
            renderMenuTable(); // Atualiza tabela visualmente PRIMEIRO
            const backendSuccess = await updateMenuOnBackend(); // Tenta salvar no backend
            if (backendSuccess) {
                showFormMessage(message, 'success');
                resetForm();
            } else {
                // Backend falhou, mensagem de erro já foi mostrada por updateMenuOnBackend
            }
        } else {
            showFormMessage(message, 'error'); // Mostra erro (item não encontrado)
            resetForm();
        }
    }

    /** Prepara o formulário para editar um item clicado */
    function handleEditClick(event) {
        const button = event.target.closest('button');
        const id = button?.dataset.id;
        const itemToEdit = menuItems.find(item => item.id === id);

        if (itemToEdit) {
            editingItemId = id;
            if (itemIdInput) itemIdInput.value = itemToEdit.id;
            itemNameInput.value = itemToEdit.name;
            itemPriceInput.value = (itemToEdit.price || 0).toFixed(2); // Usa preço numérico
            if (saveButton) saveButton.innerHTML = '<i class="fas fa-save"></i> Salvar Alterações';
            if (cancelEditButton) cancelEditButton.style.display = 'inline-block';
            itemNameInput.focus();
            // Rola a página para o topo para ver o formulário
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
            console.warn("Item para editar não encontrado com ID:", id);
        }
    }

    /** Lida com o clique no botão de excluir item */
    async function handleDeleteClick(event) {
        const button = event.target.closest('button');
        const id = button?.dataset.id;
        const itemIndex = menuItems.findIndex(item => item.id === id);

        if (itemIndex > -1) {
            const itemToDelete = menuItems[itemIndex];
            if (confirm(`Tem certeza que deseja excluir o item "${escapeHtml(itemToDelete.name)}"?`)) {
                menuItems.splice(itemIndex, 1); // Remove do array local
                renderMenuTable(); // Atualiza tabela visualmente
                const backendSuccess = await updateMenuOnBackend(); // Tenta salvar no backend
                if (backendSuccess) {
                    showFormMessage(`Item "${escapeHtml(itemToDelete.name)}" excluído.`, 'info');
                    if (editingItemId === id) { // Se estava editando o item excluído
                        resetForm();
                    }
                }
            }
        } else {
             console.warn("Item para excluir não encontrado com ID:", id);
        }
    }

    /** Reseta o formulário de item para o estado de adição */
    function resetForm() {
        editingItemId = null;
        if (adminMenuForm) adminMenuForm.reset();
        if (itemIdInput) itemIdInput.value = '';
        if (saveButton) saveButton.innerHTML = '<i class="fas fa-plus"></i> Adicionar Item';
        if (cancelEditButton) cancelEditButton.style.display = 'none';
        if (formMessage) formMessage.style.display = 'none'; // Esconde mensagem residual
    }

    // ========================================================================
    // Funções de Navegação (Abas)
    // ========================================================================

    /** Alterna a visualização entre KDS e Admin */
    function switchView(targetViewId) {
        views.forEach(view => {
            view.style.display = (view.id === targetViewId) ? 'block' : 'none';
            view.classList.toggle('active-view', view.id === targetViewId);
        });

        tabs.forEach(tab => {
             tab.classList.toggle('active', tab.dataset.target === targetViewId);
        });

        // Ações específicas ao trocar de view
        if (targetViewId === 'kds-view') {
            renderOrders(); // Garante que KDS está atualizado
        } else if (targetViewId === 'admin-view') {
            // Garante que tabela admin está atualizada (pode já ter sido carregada)
            renderMenuTable();
            resetForm(); // Reseta o formulário ao entrar na view admin
        }
    }

    // ========================================================================
    // Event Listeners Globais
    // ========================================================================

    // Listener para o formulário Admin
    if (adminMenuForm) {
        adminMenuForm.addEventListener('submit', handleFormSubmit);
    } else {
        console.error("Formulário Admin (#menu-item-form) não encontrado!");
    }

    // Listener para o botão Cancelar Edição
    if (cancelEditButton) {
        cancelEditButton.addEventListener('click', resetForm);
    }

    // Listeners para as Abas de Navegação
    tabs.forEach(tab => {
        tab.addEventListener('click', (event) => {
            const targetViewId = event.currentTarget.dataset.target;
            if (targetViewId) {
                switchView(targetViewId);
            }
        });
    });

    // Listener para botões de Ação do KDS (delegação de evento)
    if (kdsOrdersList) {
        kdsOrdersList.addEventListener('click', handleKdsButtonClick);
    }

    // Listener para atualizações no localStorage (outras abas/janelas)
    window.addEventListener('storage', (event) => {
        if (event.key === KDS_STORAGE_KEY) {
            const kdsViewElement = document.getElementById('kds-view');
            if (kdsViewElement && kdsViewElement.classList.contains('active-view')) {
                 renderOrders();
                 playNotificationSound();
            }
        }
    });

    // ========================================================================
    // Inicialização
    // ========================================================================
    async function initializeApp() {
        await loadMenuFromAPI(); // Carrega o cardápio da API primeiro
        renderOrders(); // Renderiza os pedidos KDS iniciais
        switchView('kds-view'); // Define a view KDS como inicial
    }

    initializeApp();

}); // Fim DOMContentLoaded