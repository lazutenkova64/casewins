// UI состояние
let currentTab = 'chats';
let activeMessageId = null;
let currentTheme = localStorage.getItem('theme') || 'classic-dark';

// Эмодзи
const emojiList = [
    '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', 
    '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🥸', '🤩', '🥳',
    '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '☹️', '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '😤',
    '😠', '😡', '🤬', '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😓', '🤗', '🤔', '🤭', '🤫'
];

const weirdEmojis = [
    '👾', '🤖', '👽', '💀', '👻', '👹', '👺', '🤡', '💩', '🔥',
    '🌀', '🌚', '🌝', '⭐', '🌟', '💫', '✨', '⚡', '☄️', '💥',
    '🕳️', '👁️', '🧠', '👅', '👄', '🦷', '🦴', '👀', '👃', '👂'
];

const themes = [
    { id: 'classic-dark', name: 'Классический темный', class: 'classic-dark' },
    { id: 'neon-city', name: 'Неоновый город', class: 'neon-city' },
    { id: 'cyberpunk', name: 'Киберпанк', class: 'cyberpunk' },
    { id: 'ice-cave', name: 'Ледяная пещера', class: 'ice-cave' },
    { id: 'volcanic', name: 'Вулканическая', class: 'volcanic' },
    { id: 'mint-fresh', name: 'Мятная свежесть', class: 'mint-fresh' },
    { id: 'purple-haze', name: 'Фиолетовый туман', class: 'purple-haze' },
    { id: 'golden-age', name: 'Золотой век', class: 'golden-age' },
    { id: 'cosmic-abyss', name: 'Космическая бездна', class: 'cosmic-abyss' },
    { id: 'ocean-deep', name: 'Морская глубина', class: 'ocean-deep' }
];

// Загрузка всех пользователей
async function loadAllUsers() {
    try {
        const { data, error } = await supabaseClient
            .from('profiles')
            .select('*')
            .order('username');
        
        if (error) throw error;
        
        window.allUsers = data || [];
        
        if (currentTab === 'users') {
            if (typeof window.updateChatsList === 'function') window.updateChatsList();
        }
    } catch (err) {
        console.error('Error loading users:', err);
    }
}

// Форматирование времени последнего визита
function formatLastSeen(timestamp) {
    if (!timestamp) return 'давно';
    
    const now = Date.now();
    const diff = now - timestamp;
    
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 30) return 'давно';
    if (seconds < 60) return 'только что';
    if (minutes < 60) {
        if (minutes === 1) return '1 мин назад';
        if (minutes >= 2 && minutes <= 4) return `${minutes} мин назад`;
        return `${minutes} мин назад`;
    }
    if (hours < 24) {
        if (hours === 1) return '1 час назад';
        if (hours >= 2 && hours <= 4) return `${hours} часа назад`;
        return `${hours} часов назад`;
    }
    if (days === 1) return 'вчера';
    if (days < 7) {
        if (days >= 2 && days <= 4) return `${days} дня назад`;
        return `${days} дней назад`;
    }
    
    const date = new Date(timestamp);
    return `${date.getDate()}.${date.getMonth() + 1}.${date.getFullYear()}`;
}

// Обновление профиля
function updateProfileUI() {
    if (!currentUser) return;
    
    const nameSpan = document.getElementById('profileName');
    nameSpan.innerHTML = '';
    
    const nameText = document.createTextNode(currentUser.name + ' ');
    nameSpan.appendChild(nameText);
    
    if (currentUser.isAdmin) {
        const badge = document.createElement('span');
        badge.className = 'creator-badge';
        badge.textContent = 'Создатель';
        nameSpan.appendChild(badge);
    }
    
    const statusDisplay = document.getElementById('profileStatusDisplay');
    if (currentUser.dnd) {
        statusDisplay.innerHTML = '<span class="dnd-indicator"></span> Не беспокоить';
    } else {
        statusDisplay.innerHTML = '<span class="online-indicator"></span> в сети';
    }
    
    document.getElementById('profileAvatar').textContent = currentUser.avatar || '👤';
    document.getElementById('profileAvatarLarge').textContent = currentUser.avatar || '👤';
    document.getElementById('profileBioInput').value = currentUser.bio || '';
    document.getElementById('profileDNDCheckbox').checked = currentUser.dnd || false;
}

// Переключение вкладок
function switchTab(tab) {
    currentTab = tab;
    document.getElementById('tabChats').className = tab === 'chats' ? 'tab active' : 'tab';
    document.getElementById('tabPublic').className = tab === 'public' ? 'tab active' : 'tab';
    document.getElementById('tabUsers').className = tab === 'users' ? 'tab active' : 'tab';
    document.getElementById('searchInput').value = '';
    
    if (tab === 'users') {
        loadAllUsers();
    } else if (tab === 'public') {
        if (typeof window.loadPublicChats === 'function') window.loadPublicChats();
    }
    
    if (typeof window.updateChatsList === 'function') window.updateChatsList();
    updateCreateChatButtonVisibility();
}

// Обновление видимости кнопки создания чата
function updateCreateChatButtonVisibility() {
    const createBtn = document.getElementById('createChatBtn');
    if (createBtn) {
        createBtn.style.display = currentTab === 'public' ? 'flex' : 'none';
    }
}

// Поиск
function handleSearch() {
    if (typeof window.updateChatsList === 'function') window.updateChatsList();
}

// Переключение режима авторизации
function switchAuthMode(mode) {
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const loginTab = document.getElementById('loginTabBtn');
    const registerTab = document.getElementById('registerTabBtn');
    if (mode === 'login') {
        loginForm.style.display = 'block';
        registerForm.style.display = 'none';
        loginTab.className = 'auth-tab active';
        registerTab.className = 'auth-tab';
    } else {
        loginForm.style.display = 'none';
        registerForm.style.display = 'block';
        loginTab.className = 'auth-tab';
        registerTab.className = 'auth-tab active';
    }
}

// Работа с URL
function updateUrlWithChat(chat) {
    if (chat) {
        const newUrl = `${window.location.pathname}#${chat.id}`;
        window.history.replaceState({ chatId: chat.id }, chat.name, newUrl);
        document.title = `${chat.type === 'private' && !chat.isFavorite ? 
            (chat.name.split('_').find(n => n !== currentUser?.name) || chat.name) : chat.name} - Telegram Web`;
    } else {
        const newUrl = window.location.pathname;
        window.history.replaceState({}, 'Telegram Web', newUrl);
        document.title = 'Telegram Web';
    }
}

function checkUrlForChat() {
    const hash = window.location.hash.substring(1);
    if (hash) {
        const chat = window.myChats?.find(c => c.id === hash) || window.publicChats?.find(c => c.id === hash);
        if (chat) setTimeout(() => {
            if (typeof window.joinChat === 'function') window.joinChat(chat);
        }, 500);
    }
}

// Медиа просмотр
function openMedia(url) {
    const viewer = document.getElementById('mediaViewer');
    const content = document.getElementById('mediaViewerContent');
    if (url.match(/\.(mp4|webm|ogg)$/i) || url.includes('video')) {
        content.innerHTML = `<video src="${url}" controls autoplay></video>`;
    } else {
        content.innerHTML = `<img src="${url}" style="max-width: 100%; max-height: 100%;">`;
    }
    viewer.classList.add('active');
}

function closeMediaViewer() {
    document.getElementById('mediaViewer').classList.remove('active');
    document.getElementById('mediaViewerContent').innerHTML = '';
}

// Мобильные обработчики
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('active');
}

function updateBackButtonVisibility() {
    const backButton = document.getElementById('backButton');
    if (window.innerWidth <= 768) {
        backButton.classList.add('mobile-visible');
    } else {
        backButton.classList.remove('mobile-visible');
    }
}

function setupMobileHandlers() {
    const setVH = () => {
        const vh = window.innerHeight * 0.01;
        document.documentElement.style.setProperty('--vh', `${vh}px`);
    };
    
    setVH();
    window.addEventListener('resize', setVH);
    window.addEventListener('orientationchange', setVH);
    
    forceShowInput();
}

function scrollToBottomOnMobile() {
    setTimeout(() => {
        const container = document.getElementById('messagesContainer');
        if (container) {
            container.scrollTo({
                top: container.scrollHeight,
                behavior: 'smooth'
            });
        }
    }, 300);
}

function forceShowInput() {
    const inputContainer = document.getElementById('messageInputContainer');
    const emojiBtn = document.querySelector('.emoji-toggle-btn');
    const micBtn = document.getElementById('micBtn');
    const sendBtn = document.getElementById('sendBtn');
    
    if (inputContainer) {
        inputContainer.style.display = 'flex';
        inputContainer.style.visibility = 'visible';
        inputContainer.style.opacity = '1';
    }
    
    if (emojiBtn) {
        emojiBtn.style.display = 'flex';
        emojiBtn.style.visibility = 'visible';
        emojiBtn.style.opacity = '1';
    }
    
    if (micBtn) {
        micBtn.style.display = 'flex';
        micBtn.style.visibility = 'visible';
        micBtn.style.opacity = '1';
    }
    
    if (sendBtn) {
        sendBtn.style.display = 'flex';
        sendBtn.style.visibility = 'visible';
        sendBtn.style.opacity = '1';
    }
}

// Действия с сообщениями
function handleMessagesContainerClick(event) {
    if (activeMessageId) {
        const activeMessage = document.querySelector(`.message[data-id="${activeMessageId}"]`);
        if (activeMessage && !activeMessage.contains(event.target)) {
            hideMessageActions();
        }
    }
}

function showMessageActions(messageId, event) {
    event.stopPropagation();
    
    if (activeMessageId) {
        const prevActive = document.querySelector(`.message-actions[data-message-id="${activeMessageId}"]`);
        if (prevActive) {
            prevActive.classList.remove('visible');
        }
    }
    
    const actions = document.querySelector(`.message-actions[data-message-id="${messageId}"]`);
    if (actions) {
        actions.classList.add('visible');
        activeMessageId = messageId;
        
        setTimeout(() => {
            if (activeMessageId === messageId) {
                hideMessageActions();
            }
        }, 5000);
    }
}

function hideMessageActions() {
    if (activeMessageId) {
        const actions = document.querySelector(`.message-actions[data-message-id="${activeMessageId}"]`);
        if (actions) {
            actions.classList.remove('visible');
        }
        activeMessageId = null;
    }
}

// Клавиатурные обработчики
function handleKeyPress(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (typeof window.sendMessage === 'function') window.sendMessage();
    }
}

function handleTextInput() {}

// Пароль
function togglePassword(inputId) {
    const input = document.getElementById(inputId);
    input.type = input.type === 'password' ? 'text' : 'password';
}

// Эмодзи
function toggleEmojiPicker() {
    const picker = document.getElementById('emojiPicker');
    picker.style.display = picker.style.display === 'none' ? 'flex' : 'none';
}

function populateEmojiPicker() {
    const picker = document.getElementById('emojiPicker');
    picker.innerHTML = '';
    emojiList.forEach(emoji => {
        const btn = document.createElement('button');
        btn.className = 'emoji-btn';
        btn.textContent = emoji;
        btn.onclick = () => addEmoji(emoji);
        picker.appendChild(btn);
    });
}

function addEmoji(emoji) {
    const input = document.getElementById('messageInput');
    const start = input.selectionStart;
    const end = input.selectionEnd;
    input.value = input.value.substring(0, start) + emoji + input.value.substring(end);
    input.focus();
    input.selectionStart = input.selectionEnd = start + emoji.length;
    input.style.height = 'auto';
    input.style.height = input.scrollHeight + 'px';
}

// Профиль пользователя
function openProfileModal() {
    document.getElementById('profileNameInput').value = currentUser.name;
    document.getElementById('profileBioInput').value = currentUser.bio || '';
    document.getElementById('profileDNDCheckbox').checked = currentUser.dnd || false;
    document.getElementById('profileAvatarLarge').textContent = currentUser.avatar || '👤';
    
    populateThemeGrid();
    
    document.getElementById('profileModal').classList.add('active');
}

function closeProfileModal() {
    document.getElementById('profileModal').classList.remove('active');
}

async function saveProfile() {
    const newName = document.getElementById('profileNameInput').value.trim();
    const newBio = document.getElementById('profileBioInput').value.trim();
    const dnd = document.getElementById('profileDNDCheckbox').checked;
    
    if (newName && newName !== currentUser.name) {
        const { data: existingUsers } = await supabaseClient
            .from('profiles')
            .select('username')
            .eq('username', newName)
            .neq('id', currentUser.id)
            .limit(1);
        
        if (existingUsers && existingUsers.length > 0) {
            alert('Пользователь с таким именем уже существует');
            return;
        }
        
        currentUser.name = newName;
    }
    
    currentUser.bio = newBio;
    currentUser.dnd = dnd;
    
    try {
        await supabaseClient
            .from('profiles')
            .update({
                username: currentUser.name,
                bio: currentUser.bio,
                dnd: currentUser.dnd,
                avatar: currentUser.avatar
            })
            .eq('id', currentUser.id);
        
        localStorage.setItem('currentUser', JSON.stringify(currentUser));
        
        if (window.ably) {
            const presenceChannel = window.ably.channels.get('presence');
            if (presenceChannel.state === 'attached') {
                presenceChannel.presence.update({ 
                    name: currentUser.name, 
                    avatar: currentUser.avatar,
                    bio: currentUser.bio,
                    isAdmin: currentUser.isAdmin,
                    dnd: dnd,
                    lastSeen: Date.now()
                });
            }
        }
        
        updateProfileUI();
        closeProfileModal();
        
        await loadAllUsers();
        
    } catch (err) {
        console.error('Error updating profile:', err);
        alert('Ошибка при сохранении профиля');
    }
}

// Аватар
function openAvatarModal() {
    const grid = document.getElementById('avatarGrid');
    grid.innerHTML = '';
    weirdEmojis.forEach(emoji => {
        const div = document.createElement('div');
        div.className = 'avatar-option';
        div.textContent = emoji;
        div.onclick = () => selectAvatar(emoji, div);
        if (currentUser.avatar === emoji) div.classList.add('selected');
        grid.appendChild(div);
    });
    document.getElementById('avatarModal').classList.add('active');
}

let selectedAvatar = null;

function selectAvatar(emoji, element) {
    document.querySelectorAll('.avatar-option').forEach(opt => opt.classList.remove('selected'));
    element.classList.add('selected');
    selectedAvatar = emoji;
}

async function saveAvatar() {
    if (selectedAvatar) {
        currentUser.avatar = selectedAvatar;
        
        try {
            await supabaseClient
                .from('profiles')
                .update({ avatar: currentUser.avatar })
                .eq('id', currentUser.id);
            
            localStorage.setItem('currentUser', JSON.stringify(currentUser));
            updateProfileUI();
            
            if (window.ably) {
                const presenceChannel = window.ably.channels.get('presence');
                if (presenceChannel.state === 'attached') {
                    presenceChannel.presence.update({ 
                        name: currentUser.name, 
                        avatar: selectedAvatar,
                        bio: currentUser.bio,
                        isAdmin: currentUser.isAdmin,
                        dnd: currentUser.dnd,
                        lastSeen: Date.now()
                    });
                }
            }
        } catch (err) {
            console.error('Error saving avatar:', err);
            alert('Ошибка при сохранении аватара');
        }
    }
    closeAvatarModal();
}

function closeAvatarModal() {
    document.getElementById('avatarModal').classList.remove('active');
    selectedAvatar = null;
}

// Профиль пользователя в чате
function openChatUserProfile() {
    if (!currentChat || currentChat.is_public || currentChat.isFavorite) return;
    
    const otherUserName = currentChat.name.split('_').find(name => name !== currentUser.name);
    const user = window.allUsers?.find(u => u.username === otherUserName);
    if (!user) return;
    
    const onlineUser = window.onlineUsers?.[user.id];
    const isOnline = onlineUser ? onlineUser.online : false;
    const dnd = onlineUser ? onlineUser.dnd : user.dnd;
    const lastSeen = onlineUser ? onlineUser.lastSeen : (user.last_seen ? new Date(user.last_seen).getTime() : null);
    
    let statusText = '';
    if (isOnline) {
        statusText = dnd ? 'Не беспокоит' : 'В сети';
    } else {
        statusText = lastSeen ? `Был(а) ${formatLastSeen(lastSeen)}` : 'Был(а) давно';
    }
    
    const content = `
        <div class="user-profile-avatar">${user.avatar || '👤'}</div>
        <div class="user-profile-name">${user.username}</div>
        <div class="user-profile-bio">${user.bio || 'Нет информации'}</div>
        <div class="user-profile-status">
            <span class="status-dot ${isOnline ? (dnd ? 'dnd' : 'online') : 'offline'}"></span>
            ${statusText}
        </div>
    `;
    
    document.getElementById('userProfileContent').innerHTML = content;
    document.getElementById('userProfileModal').classList.add('active');
}

function closeUserProfileModal() {
    document.getElementById('userProfileModal').classList.remove('active');
}

// Темы
function applyTheme(themeId) {
    document.documentElement.setAttribute('data-theme', themeId);
    currentTheme = themeId;
    localStorage.setItem('theme', themeId);
}

function populateThemeGrid() {
    const grid = document.getElementById('themeGrid');
    if (!grid) return;
    
    grid.innerHTML = '';
    
    themes.forEach(theme => {
        const div = document.createElement('div');
        div.className = `theme-option ${currentTheme === theme.id ? 'selected' : ''}`;
        div.onclick = () => selectTheme(theme.id, div);
        
        const preview = document.createElement('div');
        preview.className = `theme-preview ${theme.class}`;
        
        const message1 = document.createElement('div');
        message1.className = 'preview-message';
        message1.style.width = '70%';
        message1.style.marginBottom = '4px';
        
        const message2 = document.createElement('div');
        message2.className = 'preview-message';
        message2.style.width = '40%';
        message2.style.alignSelf = 'flex-end';
        message2.style.marginLeft = 'auto';
        
        preview.appendChild(message1);
        preview.appendChild(message2);
        
        const name = document.createElement('span');
        name.className = 'theme-name';
        name.textContent = theme.name;
        
        div.appendChild(preview);
        div.appendChild(name);
        grid.appendChild(div);
    });
}

function selectTheme(themeId, element) {
    document.querySelectorAll('.theme-option').forEach(opt => opt.classList.remove('selected'));
    element.classList.add('selected');
    applyTheme(themeId);
}

// Экспорт в глобальную область
window.currentTab = currentTab;
window.formatLastSeen = formatLastSeen;
window.loadAllUsers = loadAllUsers;
window.updateProfileUI = updateProfileUI;
window.switchTab = switchTab;
window.updateCreateChatButtonVisibility = updateCreateChatButtonVisibility;
window.handleSearch = handleSearch;
window.switchAuthMode = switchAuthMode;
window.updateUrlWithChat = updateUrlWithChat;
window.checkUrlForChat = checkUrlForChat;
window.openMedia = openMedia;
window.closeMediaViewer = closeMediaViewer;
window.toggleSidebar = toggleSidebar;
window.updateBackButtonVisibility = updateBackButtonVisibility;
window.setupMobileHandlers = setupMobileHandlers;
window.scrollToBottomOnMobile = scrollToBottomOnMobile;
window.forceShowInput = forceShowInput;
window.handleMessagesContainerClick = handleMessagesContainerClick;
window.showMessageActions = showMessageActions;
window.hideMessageActions = hideMessageActions;
window.handleKeyPress = handleKeyPress;
window.handleTextInput = handleTextInput;
window.togglePassword = togglePassword;
window.toggleEmojiPicker = toggleEmojiPicker;
window.populateEmojiPicker = populateEmojiPicker;
window.addEmoji = addEmoji;
window.openProfileModal = openProfileModal;
window.closeProfileModal = closeProfileModal;
window.saveProfile = saveProfile;
window.openAvatarModal = openAvatarModal;
window.selectAvatar = selectAvatar;
window.saveAvatar = saveAvatar;
window.closeAvatarModal = closeAvatarModal;
window.openChatUserProfile = openChatUserProfile;
window.closeUserProfileModal = closeUserProfileModal;
window.applyTheme = applyTheme;
window.populateThemeGrid = populateThemeGrid;
