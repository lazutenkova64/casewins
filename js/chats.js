// ========== ЧАТЫ ==========
let myChats = [];
let publicChats = [];
let currentChat = null;
let pinnedChats = [];
let unreadCounts = {};
let privateChatsMap = new Map();

async function loadUserChats() {
    if (!window.currentUser) return [];
    
    try {
        const { data: allChats, error } = await supabaseClient
            .from('chats')
            .select('*')
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        
        const userChats = (allChats || []).filter(chat => {
            if (chat.type === 'public') return true;
            if (chat.type === 'private') {
                const ids = chat.pair_key ? chat.pair_key.split('_') : [];
                return ids.includes(window.currentUser.id);
            }
            return false;
        });
        
        publicChats = (allChats || []).filter(chat => chat.is_public);
        
        myChats = userChats.map(chat => ({
            ...chat,
            avatar: chat.is_public ? '👥' : '👤'
        }));
        
        localStorage.setItem(`myChats_${window.currentUser.id}`, JSON.stringify(myChats));
        
        return myChats;
    } catch (err) {
        console.error('Error loading user chats:', err);
        return [];
    }
}

async function ensureSavedMessagesChat() {
    if (!window.currentUser) return;
    
    const pairKey = `${window.currentUser.id}_${window.currentUser.id}`;
    
    const { data: existingChat, error } = await supabaseClient
        .from('chats')
        .select('*')
        .eq('pair_key', pairKey)
        .eq('type', 'private')
        .maybeSingle();
    
    if (error) {
        console.error('Error checking saved messages chat:', error);
        return;
    }
    
    if (existingChat) {
        if (!myChats.some(c => c.id === existingChat.id)) {
            myChats.push({
                id: existingChat.id,
                name: 'Избранное',
                avatar: '⭐',
                is_public: false,
                type: 'private',
                pair_key: pairKey,
                created_at: existingChat.created_at
            });
            localStorage.setItem(`myChats_${window.currentUser.id}`, JSON.stringify(myChats));
            
            if (ably) {
                subscribeToChatChannel(existingChat.id);
            }
        }
    } else {
        try {
            const newChat = {
                name: 'Избранное',
                is_public: false,
                type: 'private',
                pair_key: pairKey,
                created_at: new Date().toISOString()
            };
            
            const { data, error } = await supabaseClient
                .from('chats')
                .insert([newChat])
                .select();
            
            if (error) throw error;
            
            myChats.push({
                id: data[0].id,
                name: 'Избранное',
                avatar: '⭐',
                is_public: false,
                type: 'private',
                pair_key: pairKey,
                created_at: data[0].created_at
            });
            localStorage.setItem(`myChats_${window.currentUser.id}`, JSON.stringify(myChats));
            
            if (ably) {
                subscribeToChatChannel(data[0].id);
            }
        } catch (err) {
            console.error('Error creating saved messages chat:', err);
        }
    }
}

async function createPublicChat() {
    const name = document.getElementById('chatNameInput').value.trim();
    
    if (!name) {
        alert('Введите название чата');
        return;
    }
    
    if (!window.currentUser.isAdmin) {
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
        
        if (ably) {
            const globalChatsChannel = ably.channels.get('global-chats');
            globalChatsChannel.publish('new-chat', createdChat);
        }
        
        if (!myChats.find(c => c.id === createdChat.id)) {
            myChats.push(createdChat);
            localStorage.setItem(`myChats_${window.currentUser.id}`, JSON.stringify(myChats));
        }
        
        joinChat(createdChat);
        closeCreateChatModal();
        
        document.getElementById('chatNameInput').value = '';
        
    } catch (err) {
        console.error('Error creating chat:', err);
        alert('Ошибка при создании чата: ' + err.message);
    }
}

async function createPrivateChat(user) {
    const ids = [window.currentUser.id, user.id].sort();
    const pairKey = ids.join('_');
    
    let privateChat = myChats.find(c => c.pair_key === pairKey && c.type === 'private');
    
    if (!privateChat) {
        const { data: existingChat, error } = await supabaseClient
            .from('chats')
            .select('*')
            .eq('pair_key', pairKey)
            .eq('type', 'private')
            .maybeSingle();
        
        if (error) {
            console.error('Error checking existing chat:', error);
        }
        
        if (existingChat) {
            privateChat = {
                id: existingChat.id,
                name: existingChat.name,
                pair_key: pairKey,
                avatar: user.avatar,
                is_public: false,
                type: 'private',
                created_at: existingChat.created_at
            };
            if (!myChats.some(c => c.id === privateChat.id)) {
                myChats.push(privateChat);
                localStorage.setItem(`myChats_${window.currentUser.id}`, JSON.stringify(myChats));
            }
        } else {
            try {
                const newChat = {
                    name: '',
                    is_public: false,
                    type: 'private',
                    pair_key: pairKey,
                    created_at: new Date().toISOString()
                };
                
                const { data, error } = await supabaseClient
                    .from('chats')
                    .insert([newChat])
                    .select();
                
                if (error) throw error;
                
                privateChat = {
                    id: data[0].id,
                    name: '',
                    pair_key: pairKey,
                    avatar: user.avatar,
                    is_public: false,
                    type: 'private',
                    created_at: data[0].created_at
                };
                
                myChats.push(privateChat);
                localStorage.setItem(`myChats_${window.currentUser.id}`, JSON.stringify(myChats));
                
                if (ably) {
                    subscribeToChatChannel(privateChat.id);
                    const chatChannel = ably.channels.get(`chat-${privateChat.id}`);
                    chatChannel.publish('user_joined', { userId: window.currentUser.id, userName: window.currentUser.name });
                    
                    const userChannel = ably.channels.get(`user-${user.id}`);
                    userChannel.publish('new-private-chat', {
                        chatId: privateChat.id,
                        pairKey: pairKey,
                        participants: [window.currentUser.id, user.id],
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
    }
    
    joinChat(privateChat);
}

function joinChat(chat) {
    if (!chat) return;
    
    currentChat = chat;
    updateUrlWithChat(chat);
    
    let displayName = chat.name;
    let avatar = chat.avatar || '👥';
    
    if (chat.type === 'private' && window.currentUser) {
        if (chat.pair_key === `${window.currentUser.id}_${window.currentUser.id}`) {
            displayName = 'Избранное';
            avatar = '⭐';
        } else {
            const otherId = chat.pair_key.split('_').find(id => id !== window.currentUser.id);
            const otherUser = window.allUsers.find(u => u.id === otherId);
            if (otherUser) {
                displayName = otherUser.username;
                avatar = otherUser.avatar || '👤';
            } else {
                displayName = 'Пользователь';
            }
        }
    }
    
    document.getElementById('currentChatName').innerHTML = displayName;
    document.getElementById('chatHeaderAvatar').textContent = avatar;
    
    document.getElementById('chatStatus').innerHTML = chat.is_public ? 'Публичный чат' : 'Приватный чат';
    document.getElementById('callBtn').style.display = (chat.type === 'private' && window.callsTableExists && displayName !== 'Избранное') ? 'flex' : 'none';
    
    loadChatHistory(chat.id);
    
    if (!window.messages[chat.id]) window.messages[chat.id] = [];
    window.messages[chat.id].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    
    markAllMessagesAsRead(chat.id);
    
    renderMessages();
    updateChatsList();
    updateChatStatus();
    
    if (window.innerWidth <= 768) {
        document.getElementById('sidebar').classList.remove('active');
    }
    
    setTimeout(() => {
        document.getElementById('messageInput').focus();
        forceShowInput();
    }, 100);
}

function updateChatStatus() {
    if (!currentChat || currentChat.is_public) return;
    
    if (currentChat.pair_key === `${window.currentUser.id}_${window.currentUser.id}`) {
        document.getElementById('chatStatus').innerHTML = '';
        return;
    }
    
    const otherId = currentChat.pair_key.split('_').find(id => id !== window.currentUser.id);
    const otherUser = window.allUsers.find(u => u.id === otherId);
    if (!otherUser) return;
    
    const userOnline = onlineUsers[otherUser.id];
    const statusElement = document.getElementById('chatStatus');
    
    if (userOnline && userOnline.online) {
        if (userOnline.dnd) {
            statusElement.innerHTML = '<span class="dnd-indicator"></span> Не беспокоить';
        } else {
            statusElement.innerHTML = '<span class="online-indicator"></span> в сети';
        }
    } else {
        const lastSeen = otherUser?.last_seen ? new Date(otherUser.last_seen).getTime() : null;
        if (lastSeen) {
            statusElement.innerHTML = `был(а) ${formatLastSeen(lastSeen)}`;
        } else {
            statusElement.innerHTML = 'был(а) давно';
        }
    }
}

async function deleteChat(chatId, event) {
    event.stopPropagation();
    if (!window.currentUser || !window.currentUser.isAdmin) return;
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
        localStorage.setItem(`myChats_${window.currentUser.id}`, JSON.stringify(myChats));
        
        delete window.messages[chatId];
        delete unreadCounts[chatId];
        
        if (currentChat && currentChat.id === chatId) {
            currentChat = null;
            renderMessages();
            updateUrlWithChat(null);
        }
        
        updateChatsList();
    } catch (err) {
        console.error('Error deleting chat:', err);
        alert('Не удалось удалить чат');
    }
}

function loadPinnedChats() {
    try {
        const saved = localStorage.getItem(`pinnedChats_${window.currentUser?.id}`);
        if (saved) {
            pinnedChats = JSON.parse(saved);
        } else {
            pinnedChats = [];
        }
    } catch (e) {
        console.error('Failed to load pinned chats', e);
        pinnedChats = [];
    }
}

function savePinnedChats() {
    if (!window.currentUser) return;
    try {
        localStorage.setItem(`pinnedChats_${window.currentUser.id}`, JSON.stringify(pinnedChats));
    } catch (e) {
        console.error('Failed to save pinned chats', e);
    }
}

function togglePinChat(chatId, event) {
    event.stopPropagation();
    if (!window.currentUser) return;
    
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
