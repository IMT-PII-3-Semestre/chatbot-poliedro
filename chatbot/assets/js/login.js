const loginText = document.querySelector(".title-text .login");
const loginForm = document.querySelector("form.login");
const loginBtn = document.querySelector("label.login");
const signupBtn = document.querySelector("label.signup");
const signupLink = document.querySelector("form .signup-link a");
const signupForm = document.querySelector("form.signup");

// Helpers to read/write users from localStorage
function getStoredUsers() {
  const stored = localStorage.getItem('poliedroUsers');
  return stored ? JSON.parse(stored) : {};
}

function storeUsers(users) {
  localStorage.setItem('poliedroUsers', JSON.stringify(users));
}

// Toggle entre abas
signupBtn.onclick = () => {
  loginForm.style.marginLeft = "-50%";
  loginText.style.marginLeft = "-50%";
};
loginBtn.onclick = () => {
  loginForm.style.marginLeft = "0%";
  loginText.style.marginLeft = "0%";
};
signupLink && (signupLink.onclick = (e) => {
  signupBtn.click();
  e.preventDefault();
});

// --- Função de Registro ---
signupForm.addEventListener('submit', function(e) {
  e.preventDefault();

  const emailInput = signupForm.querySelector('input[type="text"]');
  const pwdInput = signupForm.querySelector('input[type="password"]');
  const confirmInput = signupForm.querySelectorAll('input[type="password"]')[1];

  const email = emailInput.value.trim();
  const pwd = pwdInput.value;
  const confirmPwd = confirmInput.value;

  // Validações
  if (!email.endsWith('@poliedro.com.br')) {
    alert('O email não é valido para cadastro.');
    return;
  }
  if (pwd.length < 6) {
    alert('A senha deve ter ao menos 6 caracteres.');
    return;
  }
  if (pwd !== confirmPwd) {
    alert('A senha e a confirmação não coincidem.');
    return;
  }

  const users = getStoredUsers();
  if (users[email]) {
    alert('Já existe uma conta com este email.');
    return;
  }

  // Salva novo usuário
  users[email] = {
    password: pwd
  };
  storeUsers(users);

  alert('Cadastro realizado com sucesso! Agora faça login.');
  // Volta para aba de login
  loginBtn.click();
  signupForm.reset();
});

// --- Função de Login ---
loginForm.addEventListener('submit', function(e) {
  e.preventDefault();

  const emailInput = loginForm.querySelector('input[type="text"]');
  const pwdInput = loginForm.querySelector('input[type="password"]');

  const email = emailInput.value.trim();
  const pwd = pwdInput.value;

  const users = getStoredUsers();
  const user = users[email];

  if (!user) {
    alert('Conta não encontrada. Verifique o email ou faça cadastro.');
    return;
  }
  if (user.password !== pwd) {
    alert('Senha incorreta.');
    return;
  }

  // Login bem-sucedido
  alert(`Bem-vindo, ${email}! Você está logado.`);
  // Aqui você pode redirecionar para a página principal:
  window.location.href = 'admHome.html';
});
