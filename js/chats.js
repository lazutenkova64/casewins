// Состояние чатов
let myChats = [];
let publicChats = [];
let currentChat = null;
let pinnedChats = [];

// Загрузка чатов пользователя
async function loadUserChats() {
    if (!currentUser) return [];
    
    try {
        const { data: allChats, error } = await supabaseClient
            .from('chats')
            .select('*')
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        
        // Фильтруем чаты пользователя
        const userChats = (allChats || []).filter(chat => {
            if (chat.type === 'public') return true;
            if (chat.type === 'private') {
                const participants = chat.name.split('_');
                return participants.includes(currentUser.name);
            }
            return false;
        });
        
        publicChats = (allChats || []).filter(chat => chat.is_public);
        
        myChats = userChats.map(chat => ({
            ...chat,
            avatar: chat.is_public ? '👥' : '👤'
        }));
        
        // Добавляем чат "Избранное" если его нет
        const favoriteExists = myChats.some(c => c.name === 'Избранное');
        if (!favoriteExists) {
            const favoriteChat = {
                id: 'favorite-' + currentUser.id,
                name: 'Избранное',
                avatar: '⭐',
                is_public: false,
                type: 'private',
                created_at: new Date(0).toISOString(), // самая ранняя дата
                isFavorite: true
            };
            myChats.unshift(favoriteChat);
        }
        
        localStorage.setItem(`myChats_${currentUser.id}`, JSON.stringify(myChats));
        
        return myChats;
    } catch (err) {
        console.error('Error loading user chats:', err);
        return [];
    }
}

// Загрузка публичных чатов
async function loadPublicChats() {
    try {
        const { data, error } = await supabaseClient
            .from('chats')
            .select('*')
            .eq('is_public', true);
        
        if (error) throw error;
        
        publicChats = (data || []).map(chat => ({
            ...chat,
            avatar: '👥'
        }));
        
        if (currentTab === 'public') {
            if (typeof window.updateChatsList === 'function') window.updateChatsList();
        }
    } catch (err) {
        console.error('Error loading public chats:', err);
    }
}

// Создание приватного чата
async function createPrivateChat(user) {
    if (!currentUser) return;
    
    const participants = [currentUser.name, user.name].sort();
    const chatName = participants.join('_');
    
    // Проверяем существующий чат
    let privateChat = myChats.find(c => c.name === chatName && c.type === 'private');
    
    if (!privateChat) {
        try {
            const newChat = {
                name: chatName,
                is_public: false,
                type: 'private',
                created_at: new Date().toISOString()
            };
            
            const { data, error } = await supabaseClient
                .from('chats')
                .insert([newChat])
                .select();
            
            if (error) throw error;
            
            privateChat = {
                id: data[0].id,
                name: chatName,
                avatar: user.avatar,
                is_public: false,
                type: 'private',
                created_at: data[0].created_at
            };
            
            myChats.push(privateChat);
            localStorage.setItem(`myChats_${currentUser.id}`, JSON.stringify(myChats));
            
            if (window.ably) {
                if (typeof window.subscribeToChatChannel === 'function') {
                    window.subscribeToChatChannel(privateChat.id, false);
                }
                const chatChannel = window.ably.channels.get(`chat-${privateChat.id}`);
                chatChannel.publish('user_joined', { 
                    userId: currentUser.id, 
                    userName: currentUser.name 
                });
                
                const userChannel = window.ably.channels.get(`user-${user.id}`);
                userChannel.publish('new-private-chat', {
                    chatId: privateChat.id,
                    chatName: privateChat.name,
                    participants: [currentUser.id, user.id],
                    avatar: privateChat.avatar,
                    timestamp: Date.now()
                });
            }
        } catch (err) {
            console.error('Error creating private chat:', err);
            alert('Не удалось создать чат');
            return;
        }
    }
    
    joinChat(privateChat);
}

// Создание публичного чата
async function createPublicChat() {
    const name = document.getElementById('chatNameInput').value.trim();
    
    if (!name) {
        alert('Введите название чата');
        return;
    }
    
    // Проверка лимита для обычных пользователей
    if (!currentUser.isAdmin) {
        const userPublicChats = publicChats.length;
        if (userPublicChats >= 10) {
            alert('Вы можете создать не более 10 публичных чатов');
            return;
        }
    }
    
    try {
        const newChat = {
            name: name,
            is_public: true,
            type: 'public',
            created_at: new Date().toISOString()
        };
        
        const { data, error } = await supabaseClient
            .from('chats')
            .insert([newChat])
            .select();
        
        if (error) throw error;
        
        const createdChat = {
            id: data[0].id,
            name: data[0].name,
            is_public: data[0].is_public,
            type: data[0].type,
            created_at: data[0].created_at,
            avatar: '👥'
        };
        
        publicChats.push(createdChat);
        
        if (window.ably) {
            const globalChatsChannel = window.ably.channels.get('global-chats');
            globalChatsChannel.publish('new-chat', createdChat);
        }
        
        if (!myChats.find(c => c.id === createdChat.id)) {
            myChats.push(createdChat);
            localStorage.setItem(`myChats_${currentUser.id}`, JSON.stringify(myChats));
        }
        
        joinChat(createdChat);
        closeCreateChatModal();
        
        document.getElementById('chatNameInput').value = '';
        
    } catch (err) {
        console.error('Error creating chat:', err);
        alert('Ошибка при создании чата: ' + err.message);
    }
}

// Присоединение к чату
function joinChat(chat) {
    if (!chat) return;
    
    currentChat = chat;
    if (typeof window.updateUrlWithChat === 'function') window.updateUrlWithChat(chat);
    
    document.getElementById('currentChatName').innerHTML = 
        chat.type === 'private' && !chat.isFavorite 
            ? (chat.name.split('_').find(n => n !== currentUser?.name) || chat.name) 
            : chat.name;
    document.getElementById('chatStatus').innerHTML = chat.is_public ? 'Публичный чат' : 'Приватный чат';
    document.getElementById('chatHeaderAvatar').textContent = chat.avatar || '👥';
    
    document.getElementById('callBtn').style.display = 
        (chat.type === 'private' && !chat.isFavorite && window.callsTableExists) ? 'flex' : 'none';
    
    if (typeof window.loadChatHistory === 'function') window.loadChatHistory(chat.id);
    
    if (!window.messages) window.messages = {};
    if (!window.messages[chat.id]) window.messages[chat.id] = [];
    if (window.messages[chat.id] && Array.isArray(window.messages[chat.id])) {
        window.messages[chat.id].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    }
    
    markAllMessagesAsRead(chat.id);
    
    if (typeof window.renderMessages === 'function') window.renderMessages();
    updateChatsList();
    updateChatStatus();
    
    if (window.innerWidth <= 768) {
        document.getElementById('sidebar').classList.remove('active');
    }
    
    setTimeout(() => {
        document.getElementById('messageInput').focus();
        if (typeof window.forceShowInput === 'function') window.forceShowInput();
    }, 100);
}

// Обновление статуса чата
function updateChatStatus() {
    if (!currentChat || currentChat.is_public || currentChat.isFavorite) return;
    
    const otherUserName = currentChat.name.split('_').find(name => name !== currentUser?.name);
    const otherUser = window.allUsers?.find(u => u.username === otherUserName);
    if (!otherUser) return;
    
    const userOnline = window.onlineUsers?.[otherUser.id];
    const statusElement = document.getElementById('chatStatus');
    
    if (userOnline && userOnline.online) {
        statusElement.innerHTML = userOnline.dnd 
            ? '<span class="dnd-indicator"></span> Не беспокоить'
            : '<span class="online-indicator"></span> в сети';
    } else {
        const lastSeen = otherUser?.last_seen ? new Date(otherUser.last_seen).getTime() : null;
        statusElement.innerHTML = lastSeen ? `был(а) ${typeof window.formatLastSeen === 'function' ? window.formatLastSeen(lastSeen) : 'давно'}` : 'был(а) давно';
    }
}

// Отметка всех сообщений как прочитанных
function markAllMessagesAsRead(chatId) {
    if (!window.messages?.[chatId]) return;
    
    let changed = false;
    window.messages[chatId].forEach(msg => {
        if (msg.sender !== currentUser?.id) {
            if (!window.messageStatuses?.[msg.id] || window.messageStatuses[msg.id].status !== 'read') {
                if (!window.messageStatuses) window.messageStatuses = {};
                window.messageStatuses[msg.id] = { status: 'read', readAt: Date.now() };
                changed = true;
            }
        }
    });
    
    if (changed) {
        if (typeof window.saveMessageStatuses === 'function') window.saveMessageStatuses();
    }
    
    if (!window.unreadCounts) window.unreadCounts = {};
    window.unreadCounts[chatId] = 0;
    updateChatsList();
}

// Закрепление чатов
function loadPinnedChats() {
    try {
        const saved = localStorage.getItem(`pinnedChats_${currentUser?.id}`);
        pinnedChats = saved ? JSON.parse(saved) : [];
    } catch (e) {
        console.error('Failed to load pinned chats', e);
        pinnedChats = [];
    }
}

function savePinnedChats() {
    if (!currentUser) return;
    try {
        localStorage.setItem(`pinnedChats_${currentUser.id}`, JSON.stringify(pinnedChats));
    } catch (e) {
        console.error('Failed to save pinned chats', e);
    }
}

function togglePinChat(chatId, event) {
    event.stopPropagation();
    if (!currentUser) return;
    
    const index = pinnedChats.indexOf(chatId);
    if (index === -1) {
        pinnedChats.push(chatId);
    } else {
        pinnedChats.splice(index, 1);
    }
    savePinnedChats();
    updateChatsList();
}

function isChatPinned(chatId) {
    return pinnedChats.includes(chatId);
}

// Обновление списка чатов
function updateChatsList() {
    const list = document.getElementById('chatsList');
    if (!list) return;
    
    let items = [];
    
    if (currentTab === 'chats') {
        items = [...myChats].sort((a, b) => {
            // Избранное всегда первое
            if (a.name === 'Избранное') return -1;
            if (b.name === 'Избранное') return 1;
            
            const aPinned = isChatPinned(a.id);
            const bPinned = isChatPinned(b.id);
            
            if (aPinned && !bPinned) return -1;
            if (!aPinned && bPinned) return 1;
            
            return new Date(b.created_at) - new Date(a.created_at);
        });
    } else if (currentTab === 'public') {
        items = [...publicChats].sort((a, b) => 
            new Date(b.created_at) - new Date(a.created_at)
        );
    } else if (currentTab === 'users') {
        const allUsersList = (window.allUsers || []).map(user => {
            if (user.id === currentUser?.id) return null;
            const onlineUser = window.onlineUsers?.[user.id];
            return {
                id: user.id,
                name: user.username,
                avatar: user.avatar || '👤',
                bio: user.bio || '',
                online: onlineUser ? onlineUser.online : false,
                isAdmin: user.username === ADMIN_USERNAME,
                dnd: onlineUser ? onlineUser.dnd : (user.dnd || false),
                lastSeen: onlineUser ? onlineUser.lastSeen : (user.last_seen ? new Date(user.last_seen).getTime() : null)
            };
        }).filter(Boolean);
        
        items = allUsersList;
    }
    
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    if (searchTerm) {
        items = items.filter(item => 
            (item.name || '').toLowerCase().includes(searchTerm) ||
            (item.description || '').toLowerCase().includes(searchTerm) ||
            (item.bio || '').toLowerCase().includes(searchTerm)
        );
    }
    
    let newHTML = '';
    
    if (items.length === 0) {
        newHTML = '<div class="empty-state">Ничего не найдено</div>';
    } else {
        const fragment = [];
        items.forEach(item => {
            if (currentTab === 'users') {
                fragment.push(renderUserItem(item));
            } else {
                fragment.push(renderChatItem(item));
            }
        });
        newHTML = fragment.join('');
    }
    
    list.innerHTML = newHTML;
}

function renderUserItem(user) {
    const statusClass = user.online ? (user.dnd ? 'dnd' : 'online') : 'offline';
    const lastSeenText = !user.online && user.lastSeen ? (typeof window.formatLastSeen === 'function' ? window.formatLastSeen(user.lastSeen) : '') : '';
    
    return `
        <div class="chat-item" onclick="createPrivateChat({id: '${user.id}', name: '${user.name}', avatar: '${user.avatar}'})">
            <div class="chat-avatar">${user.avatar}</div>
            <div class="chat-details">
                <div class="chat-name">
                    ${user.name}
                    ${user.isAdmin ? '<span class="creator-badge">Создатель</span>' : ''}
                    <div class="status-container">
                        <span class="status-dot ${statusClass}"></span>
                        ${!user.online && lastSeenText ? `<span class="last-seen">${lastSeenText}</span>` : ''}
                        ${user.dnd && user.online ? '<span class="dnd-badge">Не беспокоить</span>' : ''}
                    </div>
                </div>
                <div class="chat-last-message">${user.bio || 'Нет информации'}</div>
            </div>
        </div>
    `;
}

function renderChatItem(chat) {
    const lastMsg = window.messages?.[chat.id]?.length > 0 
        ? window.messages[chat.id][window.messages[chat.id].length - 1] 
        : null;
    const unread = window.unreadCounts?.[chat.id] || 0;
    const isPinned = isChatPinned(chat.id);
    
    let lastMessageText = 'Нет сообщений';
    if (lastMsg) {
        lastMessageText = lastMsg.text ? lastMsg.text : (lastMsg.audio ? '🎤 Голосовое' : '📷 Медиа');
    }
    
    const timeText = lastMsg ? lastMsg.time : '';
    
    let displayName = chat.name;
    if (chat.type === 'private' && currentUser && !chat.isFavorite) {
        const otherName = chat.name.split('_').find(n => n !== currentUser.name);
        displayName = otherName || chat.name;
    }
    
    const deleteButton = currentUser?.isAdmin && currentUser.name === ADMIN_USERNAME && currentTab === 'public' 
        ? `<button class="delete-chat-btn" onclick="deleteChat('${chat.id}', event)">Удалить</button>` 
        : '';
    
    const pinButton = chat.name !== 'Избранное' 
        ? `<button class="pin-chat-btn ${isPinned ? 'pinned' : ''}" onclick="togglePinChat('${chat.id}', event)">📌</button>`
        : '';
    
    return `
        <div class="chat-item ${currentChat?.id === chat.id ? 'active' : ''}" onclick="joinChat(${JSON.stringify(chat).replace(/"/g, '&quot;')})">
            <div class="chat-avatar">${chat.avatar || '👥'}</div>
            <div class="chat-details">
                <div class="chat-name">
                    ${displayName}
                    ${chat.name === 'Избранное' ? '<span class="favorite-badge">⭐</span>' : ''}
                    ${isPinned ? '<span class="pin-icon">📌</span>' : ''}
                    ${chat.is_public ? '<span class="lock-icon">🌐</span>' : '<span class="lock-icon">🔒</span>'}
                    ${deleteButton}
                    ${pinButton}
                </div>
                <div class="chat-last-message">${lastMessageText}</div>
            </div>
            <div class="chat-meta">
                <div class="chat-time">${timeText}</div>
                ${unread > 0 ? `<div class="chat-unread">${unread}</div>` : ''}
            </div>
        </div>
    `;
}

// Удаление чата (только для админа)
async function deleteChat(chatId, event) {
    event.stopPropagation();
    if (!currentUser?.isAdmin) return;
    if (!confirm('Удалить этот чат навсегда?')) return;
    
    try {
        await supabaseClient
            .from('messages')
            .delete()
            .eq('chat_id', chatId);
        
        await supabaseClient
            .from('chats')
            .delete()
            .eq('id', chatId);
        
        myChats = myChats.filter(c => c.id !== chatId);
        publicChats = publicChats.filter(c => c.id !== chatId);
        localStorage.setItem(`myChats_${currentUser.id}`, JSON.stringify(myChats));
        
        if (window.messages) delete window.messages[chatId];
        if (window.unreadCounts) delete window.unreadCounts[chatId];
        
        if (currentChat?.id === chatId) {
            currentChat = null;
            if (typeof window.renderMessages === 'function') window.renderMessages();
            if (typeof window.updateUrlWithChat === 'function') window.updateUrlWithChat(null);
        }
        
        updateChatsList();
    } catch (err) {
        console.error('Error deleting chat:', err);
        alert('Не удалось удалить чат');
    }
}

// Модальные окна для чатов
function openCreateChatModal() {
    document.getElementById('createChatModal').classList.add('active');
}

function closeCreateChatModal() {
    document.getElementById('createChatModal').classList.remove('active');
    document.getElementById('chatNameInput').value = '';
}

// Экспорт в глобальную область
window.myChats = myChats;
window.publicChats = publicChats;
window.currentChat = currentChat;
window.pinnedChats = pinnedChats;

window.loadUserChats = loadUserChats;
window.loadPublicChats = loadPublicChats;
window.createPrivateChat = createPrivateChat;
window.createPublicChat = createPublicChat;
window.joinChat = joinChat;
window.updateChatStatus = updateChatStatus;
window.markAllMessagesAsRead = markAllMessagesAsRead;
window.loadPinnedChats = loadPinnedChats;
window.savePinnedChats = savePinnedChats;
window.togglePinChat = togglePinChat;
window.isChatPinned = isChatPinned;
window.updateChatsList = updateChatsList;
window.deleteChat = deleteChat;
window.openCreateChatModal = openCreateChatModal;
window.closeCreateChatModal = closeCreateChatModal;
