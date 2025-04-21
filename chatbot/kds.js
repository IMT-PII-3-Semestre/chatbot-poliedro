document.addEventListener('DOMContentLoaded', () => {
    // --- Elementos DOM ---
    const kdsOrdersList = document.getElementById('kds-orders-list'); // Verifique se este ID existe no HTML para KDS
    const adminMenuTableBody = document.getElementById('menu-table-body'); // <<< CORRIGIDO ID
    const adminMenuForm = document.getElementById('menu-item-form'); // <<< CORRIGIDO ID
    const formTitle = document.getElementById('form-title'); // Assumindo que existe no HTML
    const itemIdInput = document.getElementById('edit-item-id'); // <<< CORRIGIDO ID (verificar HTML)
    const itemNameInput = document.getElementById('item-name');
    const itemPriceInput = document.getElementById('item-price');
    const cancelEditButton = document.getElementById('cancel-edit-button'); // <<< CORRIGIDO ID (verificar HTML)
    const tabKds = document.getElementById('tab-kds');
    const tabAdmin = document.getElementById('tab-admin');
    const kdsView = document.getElementById('kds-view');
    const adminView = document.getElementById('admin-view');
    const views = document.querySelectorAll('.main-view');
    const tabs = document.querySelectorAll('.nav-tab');
    const noMenuItemsRow = document.getElementById('no-menu-items-row');
    const formMessage = document.getElementById('form-message');
    const saveButton = document.getElementById('save-button'); // Adicionado para mudar texto

    // --- Chaves de Armazenamento ---
    const KDS_STORAGE_KEY = 'pedidosCozinhaPendentes';

    // --- Variáveis de Estado ---
    let editingItemId = null; // ID do item sendo editado
    let menuItems = []; // Array para guardar itens do cardápio {id, name, price} - Carregado da API

    // --- Funções Auxiliares ---
    function escapeHtml(unsafe) { // Função para prevenir XSS simples
        if (typeof unsafe !== 'string') return unsafe;
        return unsafe
             .replace(/&/g, "&amp;")
             .replace(/</g, "&lt;")
             .replace(/>/g, "&gt;")
             .replace(/"/g, "&quot;")
             .replace(/'/g, "&#039;");
    }

    function showFormMessage(message, type = 'info') { // Exibe mensagens no formulário
        if (formMessage) {
            formMessage.textContent = message;
            formMessage.className = `admin-form-message ${type}`; // Aplica classe de estilo (success, error, info)
            formMessage.style.display = 'block';
            // Esconde a mensagem após alguns segundos
            setTimeout(() => {
                formMessage.style.display = 'none';
            }, 4000);
        } else {
            console.warn("Elemento #form-message não encontrado no HTML.");
            alert(message); // Fallback para alert
        }
    }

    // ========================================================================
    // Funções KDS (Pedidos Pendentes) - SEM ALTERAÇÕES NECESSÁRIAS AQUI
    // ========================================================================
    function formatTimestamp(isoString) { /* ... (manter como está) ... */ }
    function playNotificationSound() { /* ... (manter como está) ... */ }
    function renderOrders() { /* ... (manter como está) ... */ }
    function updateOrderState(orderId, newState) { /* ... (manter como está) ... */ }

    // ========================================================================
    // Funções Admin (Gerenciar Cardápio)
    // ========================================================================

    /**
     * NOVO: Busca o cardápio do backend via API.
     */
    async function loadMenuFromAPI() {
        console.log("Carregando cardápio da API...");
        try {
            const response = await fetch('http://localhost:5000/menu'); // Endpoint GET /menu
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`Erro HTTP ${response.status}: ${errorData.error || response.statusText}`);
            }
            const data = await response.json();
            menuItems = data || []; // Atualiza o array local, garantindo que seja um array
            console.log("Cardápio carregado da API:", menuItems);
        } catch (error) {
            console.error("Erro ao carregar cardápio da API:", error);
            showFormMessage(`Falha ao carregar o cardápio do servidor: ${error.message}`, 'error');
            menuItems = []; // Limpa em caso de erro
        } finally {
             renderMenuTable(); // Renderiza a tabela (com dados ou vazia) SEMPRE
        }
    }

    /**
     * Renderiza a tabela de itens do cardápio na visão Admin.
     */
    function renderMenuTable() {
        if (!adminMenuTableBody) {
            console.error("Elemento #menu-table-body não encontrado!");
            return;
        }
        adminMenuTableBody.innerHTML = ''; // Limpa a tabela

        if (menuItems.length === 0) {
            if (noMenuItemsRow) noMenuItemsRow.style.display = 'table-row'; // Mostra linha "Nenhum item"
        } else {
            if (noMenuItemsRow) noMenuItemsRow.style.display = 'none'; // Esconde linha "Nenhum item"
            menuItems.forEach(item => {
                const row = document.createElement('tr');
                // Usar escapeHtml para segurança
                row.innerHTML = `
                    <td>${escapeHtml(item.name)}</td>
                    <td>R$ ${parseFloat(item.price).toFixed(2)}</td>
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

        // Reanexa listeners aos botões recém-criados
        document.querySelectorAll('.edit-btn').forEach(button => {
            button.removeEventListener('click', handleEditClick); // Remove listener antigo se houver
            button.addEventListener('click', handleEditClick);
        });
        document.querySelectorAll('.delete-btn').forEach(button => {
            button.removeEventListener('click', handleDeleteClick); // Remove listener antigo se houver
            button.addEventListener('click', handleDeleteClick);
        });
    }

    /**
     * Atualiza o cardápio no backend via API.
     */
    async function updateMenuOnBackend() {
        console.log("Tentando enviar atualização do cardápio para a API...");
        console.log("Dados a serem enviados:", menuItems);
        try {
            const response = await fetch('http://localhost:5000/menu', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(menuItems) // Envia o array inteiro atualizado
            });

            const result = await response.json(); // Lê a resposta JSON

            if (!response.ok) {
                // Se a API retornar erro (status 4xx ou 5xx)
                throw new Error(result.error || `Erro HTTP ${response.status}`);
            }

            console.log("Resposta da API ao atualizar:", result.message);
            // Opcional: Mostrar feedback de sucesso no formulário, se a mensagem não for mostrada antes
            // showFormMessage(result.message || "Cardápio salvo com sucesso no servidor!", 'success');

        } catch (error) {
            console.error("Erro DENTRO de updateMenuOnBackend:", error);
            // Informa o usuário sobre a falha ao salvar
            showFormMessage(`Falha ao salvar o cardápio no servidor: ${error.message}. Recarregue a página para garantir consistência.`, 'error');
            // Considerar recarregar da API para reverter visualmente?
            // loadMenuFromAPI();
        }
    }

    /**
     * Lida com o envio do formulário para adicionar ou editar um item do cardápio.
     */
    function handleFormSubmit(event) {
        event.preventDefault();
        const name = itemNameInput.value.trim();
        const price = parseFloat(itemPriceInput.value);
        const currentEditingId = editingItemId; // Pega o ID que estava sendo editado

        if (!name || isNaN(price) || price < 0) {
            showFormMessage("Por favor, preencha o nome e um preço válido.", 'error');
            return;
        }

        let message = "";
        if (currentEditingId) {
            // Editando item existente
            const itemIndex = menuItems.findIndex(item => item.id === currentEditingId);
            if (itemIndex > -1) {
                menuItems[itemIndex].name = name;
                menuItems[itemIndex].price = price;
                message = "Item atualizado com sucesso!";
            } else {
                // Caso raro: item não encontrado, tratar como erro ou adicionar?
                console.error(`Item com ID ${currentEditingId} não encontrado para edição.`);
                message = "Erro: Item a ser editado não encontrado.";
                showFormMessage(message, 'error');
                resetForm(); // Reseta o form em caso de erro
                return; // Não prossegue para salvar
            }
        } else {
            // Adicionando novo item
            const newItem = {
                // Gera um ID simples (pode ser melhorado)
                id: `item_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
                name: name,
                price: price
            };
            menuItems.push(newItem);
            message = "Novo item adicionado com sucesso!";
        }

        renderMenuTable(); // Atualiza a tabela visualmente
        updateMenuOnBackend(); // ENVIA A ATUALIZAÇÃO PARA O BACKEND
        showFormMessage(message, 'success'); // Mostra mensagem de sucesso
        resetForm(); // Limpa o formulário e estado de edição
    }

    /**
     * Prepara o formulário para edição de um item.
     */
    function handleEditClick(event) {
        const id = event.target.closest('button').dataset.id;
        const itemToEdit = menuItems.find(item => item.id === id);
        if (itemToEdit) {
            editingItemId = id;
            if (itemIdInput) itemIdInput.value = itemToEdit.id; // Atualiza input oculto
            itemNameInput.value = itemToEdit.name;
            itemPriceInput.value = itemToEdit.price.toFixed(2);
            if (saveButton) { // Muda texto do botão Salvar
                 saveButton.innerHTML = '<i class="fas fa-save"></i> Salvar Alterações';
            }
            if (cancelEditButton) cancelEditButton.style.display = 'inline-block';
            itemNameInput.focus();
            window.scrollTo(0, 0);
        }
    }

    /**
     * Lida com a exclusão de um item.
     */
    function handleDeleteClick(event) {
        const id = event.target.closest('button').dataset.id;
        const itemToDelete = menuItems.find(item => item.id === id); // Encontra o item para mostrar o nome

        if (itemToDelete && confirm(`Tem certeza que deseja excluir o item "${escapeHtml(itemToDelete.name)}"?`)) {
            menuItems = menuItems.filter(item => item.id !== id); // Remove o item do array local
            renderMenuTable(); // Atualiza a tabela visualmente
            updateMenuOnBackend(); // ENVIA A ATUALIZAÇÃO PARA O BACKEND
            showFormMessage(`Item "${escapeHtml(itemToDelete.name)}" excluído com sucesso.`, 'info');
            if (editingItemId === id) { // Se estava editando o item excluído, reseta o form
                resetForm();
            }
        }
    }

    /**
     * Reseta o formulário para o estado de adição.
     */
    function resetForm() {
        editingItemId = null;
        if (adminMenuForm) adminMenuForm.reset();
        if (itemIdInput) itemIdInput.value = ''; // Limpa input oculto
         if (saveButton) { // Restaura texto do botão Salvar
             saveButton.innerHTML = '<i class="fas fa-plus"></i> Adicionar Item';
         }
        if (cancelEditButton) cancelEditButton.style.display = 'none';
    }

    /**
     * Alterna entre as visualizações KDS e Admin.
     */
     function switchView(targetViewId) {
        views.forEach(view => {
            if (view.id === targetViewId) {
                view.style.display = 'block'; // Ou 'flex'
                view.classList.add('active-view');
            } else {
                view.style.display = 'none';
                view.classList.remove('active-view');
            }
        });

        tabs.forEach(tab => {
             if (tab.dataset.target === targetViewId) {
                 tab.classList.add('active');
             } else {
                 tab.classList.remove('active');
             }
        });

        // Lógica adicional ao trocar de view
        if (targetViewId === 'kds-view') {
            renderOrders();
        } else if (targetViewId === 'admin-view') {
            renderMenuTable();
        }
     }

    // ========================================================================
    // Event Listeners
    // ========================================================================
    if (adminMenuForm) { // Usa a variável corrigida
        adminMenuForm.addEventListener('submit', handleFormSubmit);
    } else {
        console.error("Formulário #menu-item-form não encontrado!"); // Mensagem corrigida
    }

    if (cancelEditButton) { // Usa a variável corrigida
        cancelEditButton.addEventListener('click', resetForm);
    }

    // Listener para as ABAS
    if (tabKds && tabAdmin) {
         tabs.forEach(tab => {
             tab.addEventListener('click', (event) => {
                 const targetViewId = event.currentTarget.dataset.target;
                 if (targetViewId) {
                     switchView(targetViewId);
                 } else {
                     console.error("Botão da aba não possui data-target:", event.currentTarget);
                 }
             });
         });
    } else {
        console.error("Não foi possível encontrar os botões das abas #tab-kds ou #tab-admin.");
    }

    // Listener para KDS (storage) permanece o mesmo
    window.addEventListener('storage', (event) => {
        if (event.key === KDS_STORAGE_KEY) {
            console.log("KDS: Detectada mudança nos pedidos pendentes (localStorage). Recarregando...");
            renderOrders();
            playNotificationSound(); // Toca notificação quando novos pedidos chegam
        }
    });

    // ========================================================================
    // Inicialização
    // ========================================================================
    loadMenuFromAPI();
    renderOrders();
    switchView('kds-view'); // Define a view inicial

}); // Fim DOMContentLoaded