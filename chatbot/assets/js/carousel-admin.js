(function() {
  // Variáveis de estado
  let slideData = []; // array de objetos { imgSrc: string, title: string, price: string, description: string }
  
  // Elementos do DOM
  const btnOpen = document.getElementById('manage-carousel-btn');
  const modal = document.getElementById('carousel-admin-modal');
  const modalClose = document.getElementById('carousel-admin-close');
  const formsContainer = document.getElementById('carousel-admin-forms-container');
  const addSlideBtn = document.getElementById('add-slide-btn');
  const saveBtn = document.getElementById('save-carousel-btn');

  // Função para extrair dados dos slides atuais do Swiper
  function loadExistingSlides() {
    const swiper = window.mySwiper;
    slideData = [];
    if (!swiper) return;

    // Em modo loop, swiper.slides inclui clones; melhor extrair de slides “reais”.
    // Swiper API: use swiper.slides e filtre pelos que não tenham classe 'swiper-slide-duplicate'
    swiper.slides.forEach(slideEl => {
      if (slideEl.classList.contains('swiper-slide-duplicate')) return;
      // Dentro de slideEl, buscamos img e conteúdo
      const imgEl = slideEl.querySelector('.image img');
      const contentEl = slideEl.querySelector('.content');
      if (!imgEl || !contentEl) return;
      const imgSrc = imgEl.getAttribute('src');
      // No content, pegamos h2 e p
      const h2 = contentEl.querySelector('h2');
      const p = contentEl.querySelector('p');
      let title = '', price = '';
      if (h2) {
        // separa por quebra de linha
        const text = h2.innerText.trim();
        const parts = text.split('\n').map(s => s.trim()).filter(s => s);
        if (parts.length >= 2) {
          title = parts[0];
          price = parts[1];
        } else if (parts.length === 1) {
          title = parts[0];
        }
      }
      const description = p ? p.innerText.trim() : '';
      slideData.push({
        imgSrc,
        title,
        price,
        description
      });
    });
  }

  // Função para criar um bloco de formulário para um slide (retorna elemento DOM)
  function createSlideForm(index, data) {
    // data: { imgSrc, title, price, description }
    const wrapper = document.createElement('div');
    wrapper.className = 'carousel-slide-form';
    wrapper.dataset.index = index;

    // Título do bloco
    const h4 = document.createElement('h4');
    h4.innerText = `Slide ${index + 1}`;
    wrapper.appendChild(h4);

    // Botão remover
    const btnRemove = document.createElement('button');
    btnRemove.type = 'button';
    btnRemove.className = 'remove-slide-btn';
    btnRemove.innerHTML = '&times;';
    btnRemove.title = 'Remover este slide';
    btnRemove.addEventListener('click', () => {
      wrapper.remove();
      // Após remover, precisamos reindexar títulos de formulários
      reindexForms();
    });
    wrapper.appendChild(btnRemove);

    // Campo: URL de imagem
    const labelUrl = document.createElement('label');
    labelUrl.innerText = 'URL da Imagem (deixe em branco se for usar upload):';
    wrapper.appendChild(labelUrl);
    const inputUrl = document.createElement('input');
    inputUrl.type = 'text';
    inputUrl.value = data.imgSrc || '';
    inputUrl.placeholder = 'https://exemplo.com/imagem.jpg';
    wrapper.appendChild(inputUrl);

    // Campo: upload de arquivo de imagem
    const labelFile = document.createElement('label');
    labelFile.innerText = 'Escolher arquivo de imagem (opcional, sobrescreve URL):';
    wrapper.appendChild(labelFile);
    const inputFile = document.createElement('input');
    inputFile.type = 'file';
    inputFile.accept = 'image/*';
    wrapper.appendChild(inputFile);

    // Preview de imagem
    const imgPreview = document.createElement('img');
    imgPreview.className = 'image-preview';
    imgPreview.alt = 'Preview da Imagem';
    if (data.imgSrc) {
      imgPreview.src = data.imgSrc;
    } else {
      imgPreview.style.display = 'none';
    }
    wrapper.appendChild(imgPreview);

    // Ao selecionar arquivo, mostrar preview
    inputFile.addEventListener('change', function() {
      const file = inputFile.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
          imgPreview.src = e.target.result;
          imgPreview.style.display = 'block';
        };
        reader.readAsDataURL(file);
      }
    });

    // Campo: título
    const labelTitle = document.createElement('label');
    labelTitle.innerText = 'Título:';
    wrapper.appendChild(labelTitle);
    const inputTitle = document.createElement('input');
    inputTitle.type = 'text';
    inputTitle.value = data.title || '';
    inputTitle.placeholder = 'Ex: X-Salada';
    wrapper.appendChild(inputTitle);

    // Campo: preço
    const labelPrice = document.createElement('label');
    labelPrice.innerText = 'Preço:';
    wrapper.appendChild(labelPrice);
    const inputPrice = document.createElement('input');
    inputPrice.type = 'text';
    inputPrice.value = data.price || '';
    inputPrice.placeholder = 'Ex: R$ 20,00';
    wrapper.appendChild(inputPrice);

    // Campo: descrição
    const labelDesc = document.createElement('label');
    labelDesc.innerText = 'Descrição:';
    wrapper.appendChild(labelDesc);
    const textareaDesc = document.createElement('textarea');
    textareaDesc.rows = 3;
    textareaDesc.value = data.description || '';
    textareaDesc.placeholder = 'Descreva o item...';
    wrapper.appendChild(textareaDesc);

    return wrapper;
  }

  // Reindexa os títulos e data-index dos formulários após remoção/adição
  function reindexForms() {
    const forms = formsContainer.querySelectorAll('.carousel-slide-form');
    forms.forEach((formEl, idx) => {
      formEl.dataset.index = idx;
      const h4 = formEl.querySelector('h4');
      if (h4) {
        h4.innerText = `Slide ${idx + 1}`;
      }
    });
  }

  // Abre o modal e preenche os formulários atuais
  function openModal() {
    loadExistingSlides();
    formsContainer.innerHTML = '';
    slideData.forEach((data, idx) => {
      const formEl = createSlideForm(idx, data);
      formsContainer.appendChild(formEl);
    });
    modal.style.display = 'flex';
  }

  // Fecha o modal
  function closeModal() {
    modal.style.display = 'none';
  }

  // Função para reconstruir slides no Swiper a partir de slideData
  function rebuildSlides() {
    const swiper = window.mySwiper;
    if (!swiper) return;
    // Desativa loop temporariamente para remover corretamente
    swiper.loopDestroy && swiper.loopDestroy(); // para versões que tenham loopDestroy
    // Remove todos os slides
    swiper.removeAllSlides();
    // Adiciona novos slides
    slideData.forEach(item => {
      // Monta HTML semelhante aos slides originais
      const html = `
      <div class="swiper-slide spotlight">
        <div class="image"><img src="${item.imgSrc}" alt="${item.title}" /></div>
        <div class="content">
          <h2>${item.title}<br />${item.price}</h2>
          <p>${item.description}</p>
        </div>
      </div>`;
      swiper.appendSlide(html);
    });
    // Recria loop se desejado:
    swiper.params.loop = true;
    swiper.loopCreate && swiper.loopCreate();
    // Atualiza
    swiper.update();
  }

  // Ao clicar em “Salvar Alterações”
  function saveChanges() {
    const forms = Array.from(formsContainer.querySelectorAll('.carousel-slide-form'));
    // Vamos processar cada form, possivelmente lendo arquivos de imagem
    const readPromises = forms.map((formEl, idx) => {
      return new Promise((resolve) => {
        const inputUrl = formEl.querySelector('input[type="text"]');
        const inputFile = formEl.querySelector('input[type="file"]');
        const inputTitle = formEl.querySelector('input[type="text"][placeholder*="Ex:"]') 
          || formEl.querySelectorAll('input[type="text"]')[1]; // tentativa de pegar o campo Título
        // Melhor identificar pelos labels: mas aqui assumimos ordem criada: primeiro URL, depois file, depois título, depois preço.
        const inputs = formEl.querySelectorAll('input[type="text"]');
        let titleVal = '';
        let priceVal = '';
        // inputs[0] = URL, inputs[1] = título, inputs[2] = preço
        if (inputs.length >= 3) {
          titleVal = inputs[1].value.trim();
          priceVal = inputs[2].value.trim();
        } else {
          // fallback: procurar labels
          titleVal = formEl.querySelector('input[placeholder*="X-Salada"]')?.value.trim() || '';
          priceVal = formEl.querySelector('input[placeholder*="R$"]')?.value.trim() || '';
        }
        const textareaDesc = formEl.querySelector('textarea');
        const descVal = textareaDesc ? textareaDesc.value.trim() : '';

        if (inputFile && inputFile.files && inputFile.files[0]) {
          // leitura de arquivo
          const file = inputFile.files[0];
          const reader = new FileReader();
          reader.onload = function(e) {
            const dataUrl = e.target.result;
            resolve({
              imgSrc: dataUrl,
              title: titleVal,
              price: priceVal,
              description: descVal
            });
          };
          reader.readAsDataURL(file);
        } else {
          // Sem arquivo, usa URL
          const urlVal = inputUrl.value.trim();
          resolve({
            imgSrc: urlVal,
            title: titleVal,
            price: priceVal,
            description: descVal
          });
        }
      });
    });

    // Depois de ler todos (sincrono ou async), atualiza slideData e rebuild
    Promise.all(readPromises).then(results => {
     slideData = results.filter(item => item.imgSrc);
     rebuildSlides();
+    persistSlidesToLocal();   // <-- salva no localStorage
     closeModal();
   });
  }

  // Ao clicar em “Adicionar Novo Slide”
  function addNewSlideForm() {
    const idx = formsContainer.querySelectorAll('.carousel-slide-form').length;
    const newData = { imgSrc: '', title: '', price: '', description: '' };
    const formEl = createSlideForm(idx, newData);
    formsContainer.appendChild(formEl);
    reindexForms();
  }

  // Eventos
  btnOpen.addEventListener('click', openModal);
  modalClose.addEventListener('click', closeModal);
  window.addEventListener('click', function(e) {
    if (e.target === modal) {
      closeModal();
    }
  });
  addSlideBtn.addEventListener('click', addNewSlideForm);
  saveBtn.addEventListener('click', saveChanges);

  function persistSlidesToLocal() {
    try {
        localStorage.setItem('poliedroSlides', JSON.stringify(slideData));
        console.log('Slides salvos com sucesso no localStorage');
    } catch (e) {
        console.error('Falha ao salvar slides:', e);
    }
  }

  // Se quiser carregar slideData / formulários somente após Swiper estar pronto, você pode aguardar DOMContentLoaded.
  // Aqui assumimos que este script é incluído após inicialização do Swiper.
})();
