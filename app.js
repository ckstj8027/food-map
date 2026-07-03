// Gourmet Map Application Logic (Supabase Auth & Multi-user Sync)

// State Management
let gourmets = [];
let map = null;
let markerClusterGroup = null;
let nearbyPlacesLayerGroup = null; // Layer group for real places from search
let currentMarkers = {}; // Store markers by gourmet ID
let userLocationMarker = null;
let activeSort = 'recent'; // 'recent' or 'rating'
let supabaseClient = null;

// Auth State
let currentUser = null;
let currentAuthMode = 'login'; // 'login' or 'signup'

// Inline Edit / Delete Targets
let deleteTargetId = null;

// Category Icons Mapping (Material Icons)
const categoryIcons = {
  '한식': 'ramen_dining',
  '중식': 'soup_kitchen',
  '일식': 'bento',
  '양식': 'local_pizza',
  '카페': 'local_cafe',
  '기타': 'restaurant'
};

// Default Coordinator (Seoul Station)
const defaultCenter = [37.554722, 126.970833];

// Initialize App
function initApp() {
  // Initialize Supabase Client
  initSupabase();

  // Setup Auth Listeners (Wait for session trigger)
  setupAuthListeners();

  // Setup Map
  initMap();

  // Load Geo Location
  getUserLocation();

  // Event Listeners for Filters
  document.getElementById('search-input').addEventListener('input', filterAndRender);
  document.getElementById('category-filter').addEventListener('change', filterAndRender);
  document.getElementById('status-filter').addEventListener('change', filterAndRender);
  
  // Geolocation Button Listener
  document.getElementById('geo-btn').addEventListener('click', getUserLocation);

  // Sorting Tab Listeners
  document.getElementById('sort-recent-btn').addEventListener('click', () => changeSort('recent'));
  document.getElementById('sort-rating-btn').addEventListener('click', () => changeSort('rating'));

  // Logout Button Listener
  document.getElementById('logout-btn').addEventListener('click', handleLogout);

  // Delete Action in Modal
  document.getElementById('modal-delete-action-btn').addEventListener('click', confirmDeleteGourmet);

  // Bind Kakao place search enter key
  document.getElementById('kakao-search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      searchKakaoPlaces();
    }
  });

  // Bind Map address search enter key
  document.getElementById('map-search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      searchMapLocation();
    }
  });

  // Search Nearby Real Restaurants
  document.getElementById('search-nearby-btn').addEventListener('click', searchNearbyKakaoPlaces);

  // Render Sidebar List
  renderSidebarList();
}

// Initialize Supabase Connection
function initSupabase() {
  try {
    if (typeof SUPABASE_CONFIG !== 'undefined' && SUPABASE_CONFIG.URL && SUPABASE_CONFIG.ANON_KEY) {
      supabaseClient = supabase.createClient(SUPABASE_CONFIG.URL, SUPABASE_CONFIG.ANON_KEY);
      console.log("Supabase Client successfully initialized.");
    } else {
      console.warn("Supabase credentials not found in config.js. Running in offline/localStorage mode.");
    }
  } catch (e) {
    console.error("Failed to initialize Supabase client:", e);
  }
}

// Set up Auth Observers
function setupAuthListeners() {
  if (supabaseClient) {
    // Check initial session
    supabaseClient.auth.getSession().then(({ data: { session } }) => {
      handleAuthStateChange(session);
    });

    // Listen to changes in auth state
    supabaseClient.auth.onAuthStateChange((event, session) => {
      // Trigger appropriate toast message on specific events
      if (event === 'SIGNED_IN' && session) {
        showToast("성공적으로 로그인되었습니다!", "success");
      } else if (event === 'SIGNED_OUT') {
        showToast("로그아웃되었습니다.", "info");
      }
      handleAuthStateChange(session);
    });
  } else {
    // Fallback: Mock login for offline demonstration
    console.warn("Supabase auth unavailable. Auto-logging in with mock guest account.");
    handleAuthStateChange({
      user: { id: 'mock-user-1234', email: 'guest@gourmet-map.local' }
    });
  }
}

// Handle login/logout state change in UI
function handleAuthStateChange(session) {
  const authModal = document.getElementById('auth-modal');
  const userProfile = document.getElementById('user-profile');
  const emailDisplay = document.getElementById('user-email-display');

  if (session && session.user) {
    currentUser = session.user;
    emailDisplay.textContent = currentUser.email || "사용자 님";
    
    // Hide login modal, show user profile
    authModal.classList.add('hidden');
    userProfile.classList.remove('hidden');

    // Enable interaction
    enableAppInteraction(true);

    // Load user's gourmet list
    loadGourmets();
  } else {
    currentUser = null;
    emailDisplay.textContent = '';
    
    // Show login modal, hide user profile
    authModal.classList.remove('hidden');
    userProfile.classList.add('hidden');

    // Disable interaction
    enableAppInteraction(false);

    // Clear maps and data
    gourmets = [];
    if (markerClusterGroup) {
      markerClusterGroup.clearLayers();
    }
    if (nearbyPlacesLayerGroup) {
      nearbyPlacesLayerGroup.clearLayers();
    }
    const clearBtn = document.getElementById('clear-nearby-btn');
    if (clearBtn) {
      clearBtn.classList.add('hidden');
    }
    renderSidebarList();
  }
}

// Lock sidebar, search, buttons if not logged in
function enableAppInteraction(enabled) {
  const elements = [
    document.getElementById('search-input'),
    document.getElementById('category-filter'),
    document.getElementById('status-filter'),
    document.getElementById('geo-btn'),
    document.getElementById('sort-recent-btn'),
    document.getElementById('sort-rating-btn'),
    document.getElementById('search-nearby-btn'),
    document.getElementById('clear-nearby-btn'),
    document.getElementById('map-search-input')
  ];

  elements.forEach(el => {
    if (el) el.disabled = !enabled;
  });

  const sidebar = document.getElementById('sidebar');
  if (sidebar) {
    if (enabled) {
      sidebar.style.pointerEvents = 'auto';
      sidebar.style.opacity = '1';
    } else {
      sidebar.style.pointerEvents = 'none';
      sidebar.style.opacity = '0.5';
    }
  }
}

// Switch between Login and Signup modes
window.switchAuthTab = function(mode) {
  currentAuthMode = mode;
  const tabLogin = document.getElementById('tab-login');
  const tabSignup = document.getElementById('tab-signup');
  const submitBtn = document.getElementById('auth-submit-btn');
  const errorBox = document.getElementById('auth-error');

  errorBox.classList.add('hidden');
  errorBox.textContent = '';

  if (mode === 'login') {
    tabLogin.classList.add('active');
    tabSignup.classList.remove('active');
    submitBtn.textContent = '로그인';
  } else {
    tabLogin.classList.remove('active');
    tabSignup.classList.add('active');
    submitBtn.textContent = '회원가입';
  }
};

// Handle Authentication Submit Form
window.handleAuthSubmit = async function(e) {
  e.preventDefault();
  
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const errorBox = document.getElementById('auth-error');
  const submitBtn = document.getElementById('auth-submit-btn');

  // Validate password length
  if (password.length < 6) {
    showAuthError("비밀번호는 최소 6자 이상이어야 합니다.");
    showToast("비밀번호 기준 미달 (최소 6자)", "error");
    return;
  }

  // Visual Loading State
  submitBtn.disabled = true;
  submitBtn.textContent = currentAuthMode === 'login' ? '로그인 중...' : '가입 중...';
  errorBox.classList.add('hidden');

  try {
    if (currentAuthMode === 'login') {
      const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
      console.log("Logged in successfully:", data);
    } else {
      const { data, error } = await supabaseClient.auth.signUp({ email, password });
      if (error) throw error;
      
      if (data && data.user) {
        if (data.session) {
          showToast("회원가입 및 로그인이 성공적으로 완료되었습니다!", "success");
        } else {
          showToast("회원가입 완료! 가입 이메일의 인증 메일을 확인해 주세요.", "info");
          switchAuthTab('login');
        }
      }
    }
  } catch (err) {
    console.error("Auth Error:", err);
    showAuthError(err.message || "인증에 실패했습니다. 다시 시도해 주세요.");
    showToast("인증 실패: " + (err.message || "오류"), "error");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = currentAuthMode === 'login' ? '로그인' : '회원가입';
  }
};

// Custom toast notification system (Non-blocking)
window.showToast = function(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  let iconName = 'info';
  if (type === 'success') iconName = 'check_circle';
  if (type === 'error') iconName = 'error';

  toast.innerHTML = `
    <span class="material-symbols-rounded" style="font-variation-settings: 'FILL' 1;">${iconName}</span>
    <span>${message}</span>
  `;

  container.appendChild(toast);

  // Auto remove after 3 seconds
  setTimeout(() => {
    toast.classList.add('fade-out');
    toast.addEventListener('animationend', () => {
      toast.remove();
    });
  }, 3000);
};

function showAuthError(msg) {
  const errorBox = document.getElementById('auth-error');
  errorBox.textContent = msg;
  errorBox.classList.remove('hidden');
}

// Handle Sign out
async function handleLogout() {
  if (supabaseClient) {
    try {
      const { error } = await supabaseClient.auth.signOut();
      if (error) throw error;
    } catch (err) {
      console.error("Sign out error:", err);
      handleAuthStateChange(null);
    }
  } else {
    handleAuthStateChange(null);
  }
}

// Load user's private data from Supabase DB (with user-specific localStorage cache)
async function loadGourmets() {
  if (!currentUser) return;

  if (supabaseClient) {
    try {
      // Query filters data specifically for the logged-in user
      const { data, error } = await supabaseClient
        .from('gourmets')
        .select('*')
        .eq('user_id', currentUser.id);
      
      if (error) throw error;
      
      if (data && data.length > 0) {
        gourmets = data;
        console.log(`Loaded ${gourmets.length} items from Supabase for user:`, currentUser.email);
        saveToLocalStorage();
      } else {
        // DB is empty, seed it!
        console.log("DB is empty for user. Seeding initial gourmet spots...");
        await seedDefaultGourmets();
      }
    } catch (err) {
      console.error("Failed to load from Supabase, fallback to localStorage:", err);
      loadFromLocalStorage();
    }
  } else {
    loadFromLocalStorage();
  }

  // Refresh view
  filterAndRender();
}

// Seed initial demo data in Supabase for new user account
async function seedDefaultGourmets() {
  const seeds = [
    {
      name: '서울 삼계탕 본점 🍗',
      category: '한식',
      lat: 37.5605,
      lng: 126.9745,
      address: '서울특별시 중구 태평로2가 58',
      visited: true,
      rating: 5,
      date: '2026-06-25',
      img: 'https://images.unsplash.com/photo-1616683693504-3ea7e9ad6fec?w=600&auto=format&fit=crop&q=80',
      memo: '국물이 진짜 진하고 고기가 부드러워요. 부모님 모시고 가기 딱 좋습니다!',
      user_id: currentUser.id
    },
    {
      name: '이탈리안 마리오 피자 🍕',
      category: '양식',
      lat: 37.5512,
      lng: 126.9630,
      address: '서울특별시 용산구 청파동2가 120',
      visited: false,
      rating: 1,
      date: '',
      img: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=600&auto=format&fit=crop&q=80',
      memo: '화덕 피자로 유명하다고 해서 가보려고 저장해 둔 곳. 루꼴라 피자가 시그니처라고 함.',
      user_id: currentUser.id
    },
    {
      name: '하루 에스프레소 바 ☕',
      category: '카페',
      lat: 37.5582,
      lng: 126.9790,
      address: '서울특별시 중구 회현동1가 200',
      visited: true,
      rating: 4,
      date: '2026-07-01',
      img: 'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?w=600&auto=format&fit=crop&q=80',
      memo: '에스프레소 콘파냐가 맛있음. 매장은 작지만 인테리어가 감각적이에요.',
      user_id: currentUser.id
    },
    {
      name: '대성각 수제짬뽕 🍜',
      category: '중식',
      lat: 37.5598,
      lng: 126.9678,
      address: '서울특별시 중구 만리동1가 35',
      visited: true,
      rating: 4,
      date: '2026-06-28',
      img: 'https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=600&auto=format&fit=crop&q=80',
      memo: '해물 짬뽕 양이 어마어마하고 찹쌀 탕수육도 바삭바삭 맛있어요!',
      user_id: currentUser.id
    },
    {
      name: '미도리 스시 전문점 🍣',
      category: '일식',
      lat: 37.5632,
      lng: 126.9730,
      address: '서울특별시 중구 을지로1가 90',
      visited: false,
      rating: 1,
      date: '',
      img: 'https://images.unsplash.com/photo-1579871494447-9811cf80d66c?w=600&auto=format&fit=crop&q=80',
      memo: '신선한 생선 초밥으로 유명한 곳. 평일 점심에도 웨이팅이 길어 주말에 갈 예정.',
      user_id: currentUser.id
    }
  ];

  try {
    const { data, error } = await supabaseClient
      .from('gourmets')
      .insert(seeds)
      .select();

    if (error) throw error;
    
    gourmets = data || seeds;
    saveToLocalStorage();
    console.log("Successfully seeded default gourmets into Supabase:", gourmets);
    showToast("새 계정에 5개의 초기 맛집 데이터가 자동 연동되었습니다!", "success");
  } catch (err) {
    console.error("Failed to seed to Supabase:", err);
    gourmets = [];
    showToast("데이터베이스 초기화에 실패했습니다.", "error");
  }
}


// Helper: Load user-specific backup data from LocalStorage
function loadFromLocalStorage() {
  if (!currentUser) return;
  const storageKey = `gourmets_${currentUser.id}`;
  const data = localStorage.getItem(storageKey);
  
  if (data) {
    gourmets = JSON.parse(data);
  } else {
    gourmets = [];
  }
}

function saveToLocalStorage() {
  if (!currentUser) return;
  localStorage.setItem(`gourmets_${currentUser.id}`, JSON.stringify(gourmets));
}

// Map Initialization
function initMap() {
  map = L.map('map', {
    zoomControl: false
  }).setView(defaultCenter, 14);

  L.control.zoom({
    position: 'bottomright'
  }).addTo(map);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 20
  }).addTo(map);

  markerClusterGroup = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: 50
  });
  map.addLayer(markerClusterGroup);

  // Initialize Layer Group for Nearby Places
  nearbyPlacesLayerGroup = L.layerGroup().addTo(map);

  map.on('click', onMapClick);
  renderMarkers(gourmets);
}

// Get GPS location
function getUserLocation() {
  if (!currentUser) return; // Prevent action if logged out

  if (!navigator.geolocation) {
    showToast('이 브라우저는 현재 위치 가져오기 기능을 지원하지 않습니다.', 'error');
    return;
  }

  const geoBtn = document.getElementById('geo-btn');
  geoBtn.classList.add('loading');
  geoBtn.querySelector('.material-symbols-rounded').textContent = 'sync';

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      const userLoc = [lat, lng];

      map.setView(userLoc, 15);

      if (userLocationMarker) {
        userLocationMarker.setLatLng(userLoc);
      } else {
        const userIcon = L.divIcon({
          className: 'user-location-marker-container',
          html: '<div class="user-loc-marker"></div>',
          iconSize: [24, 24],
          iconAnchor: [12, 12]
        });
        userLocationMarker = L.marker(userLoc, { icon: userIcon }).addTo(map);
      }

      resetGeoBtn();
      showToast('현재 위치를 불러왔습니다.', 'success');
    },
    (error) => {
      console.warn('Geolocation Error: ', error);
      showToast('위치 정보를 가져올 수 없습니다. 권한 설정을 확인하세요.', 'error');
      resetGeoBtn();
    },
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

function resetGeoBtn() {
  const geoBtn = document.getElementById('geo-btn');
  if (geoBtn) {
    geoBtn.classList.remove('loading');
    geoBtn.querySelector('.material-symbols-rounded').textContent = 'my_location';
  }
}

// Kakao Location Search to pan map
window.searchMapLocation = function() {
  const query = document.getElementById('map-search-input').value.trim();
  if (!query) {
    showToast("검색할 주소나 지역명을 입력해 주세요.", "error");
    return;
  }

  if (typeof kakao === 'undefined') {
    showToast("카카오 라이브러리가 로드되지 않았습니다.", "error");
    return;
  }

  kakao.maps.load(() => {
    if (!kakao.maps.services) {
      showToast("카카오 서비스 라이브러리가 존재하지 않습니다.", "error");
      return;
    }

    const ps = new kakao.maps.services.Places();
    
    ps.keywordSearch(query, (data, status) => {
      if (status === kakao.maps.services.Status.OK) {
        const firstPlace = data[0];
        const lat = parseFloat(firstPlace.y);
        const lng = parseFloat(firstPlace.x);
        
        map.setView([lat, lng], 16);
        showToast(`'${firstPlace.place_name}' 위치로 지도를 이동했습니다.`, "success");
      } else if (status === kakao.maps.services.Status.ZERO_RESULT) {
        showToast("검색 결과가 없습니다. 다른 지명으로 검색해 보세요.", "info");
      } else {
        showToast("장소 검색 중 에러가 발생했습니다.", "error");
      }
    });
  });
};

// Kakao Place Search Keyword Service
window.searchKakaoPlaces = function() {
  const query = document.getElementById('kakao-search-input').value.trim();
  const resultsContainer = document.getElementById('kakao-search-results');
  if (!query) {
    showToast("검색어를 입력해 주세요.", "error");
    return;
  }
  
  resultsContainer.innerHTML = `<li style="padding: 12px; font-size: 13px; color: var(--text-secondary); text-align: center;">검색 중...</li>`;
  resultsContainer.classList.remove('hidden');

  if (typeof kakao === 'undefined') {
    resultsContainer.innerHTML = `<li style="padding: 12px; font-size: 13px; color: var(--want-to-go-color); text-align: center;">카카오 지도 라이브러리가 로드되지 않았습니다.</li>`;
    return;
  }

  // Load dynamically via kakao.maps.load
  kakao.maps.load(() => {
    if (!kakao.maps.services) {
      resultsContainer.innerHTML = `<li style="padding: 12px; font-size: 13px; color: var(--want-to-go-color); text-align: center;">서비스 라이브러리가 존재하지 않습니다.</li>`;
      return;
    }

    // Initialize Kakao Places Service
    const ps = new kakao.maps.services.Places();
    
    // Search by keyword
    ps.keywordSearch(query, (data, status) => {
      resultsContainer.innerHTML = '';
      if (status === kakao.maps.services.Status.OK) {
        data.forEach(place => {
          const li = document.createElement('li');
          li.style.padding = '10px 14px';
          li.style.borderBottom = '1px solid var(--border-color)';
          li.style.cursor = 'pointer';
          li.style.fontSize = '13px';
          li.style.textAlign = 'left';
          li.style.transition = 'background-color 0.2s ease';
          
          li.innerHTML = `
            <div style="font-weight: 700; color: var(--text-main); margin-bottom: 2px;">${place.place_name}</div>
            <div style="font-size: 11px; color: var(--text-secondary);">${place.road_address_name || place.address_name}</div>
          `;
          
          li.addEventListener('click', () => {
            // Auto fill fields
            document.getElementById('form-name').value = place.place_name;
            document.getElementById('form-address').value = place.road_address_name || place.address_name;
            document.getElementById('form-lat').value = place.y;
            document.getElementById('form-lng').value = place.x;
            
            showToast(`'${place.place_name}' 정보가 자동 입력되었습니다.`, "success");
            resultsContainer.classList.add('hidden');
          });
          
          // Hover effects in JS
          li.addEventListener('mouseenter', () => li.style.backgroundColor = 'rgba(255,255,255,0.06)');
          li.addEventListener('mouseleave', () => li.style.backgroundColor = 'transparent');

          resultsContainer.appendChild(li);
        });
      } else if (status === kakao.maps.services.Status.ZERO_RESULT) {
        resultsContainer.innerHTML = `<li style="padding: 12px; font-size: 13px; color: var(--text-secondary); text-align: center;">검색 결과가 없습니다.</li>`;
      } else {
        resultsContainer.innerHTML = `<li style="padding: 12px; font-size: 13px; color: var(--want-to-go-color); text-align: center;">검색 중 오류가 발생했습니다.</li>`;
      }
    });
  });
};

// Search Nearby Real Places using Kakao Places Services Category Search
window.searchNearbyKakaoPlaces = function() {
  if (!currentUser) return;

  const searchBtn = document.getElementById('search-nearby-btn');
  searchBtn.disabled = true;
  searchBtn.querySelector('span').textContent = 'sync';
  searchBtn.querySelector('span').classList.add('loading-spin'); // spin animation
  searchBtn.querySelector('span').style.animation = 'spin 1.5s linear infinite';
  
  if (typeof kakao === 'undefined') {
    showToast("카카오 라이브러리가 로드되지 않았습니다.", "error");
    resetSearchNearbyBtn();
    return;
  }

  // Load dynamically via kakao.maps.load
  kakao.maps.load(() => {
    if (!kakao.maps.services) {
      showToast("카카오 서비스 라이브러리가 존재하지 않습니다.", "error");
      resetSearchNearbyBtn();
      return;
    }

    const center = map.getCenter();
    const loc = new kakao.maps.LatLng(center.lat, center.lng);
    const ps = new kakao.maps.services.Places();

    let combinedResults = [];
    let pendingCategories = 2; // Restaurants (FD6) and Cafes (CE7)

    // Helper function to recursively retrieve all pages (up to 3 pages / 45 items per category)
    const fetchCategoryPages = (categoryCode) => {
      let categoryResults = [];

      const pageCallback = (data, status, pagination) => {
        if (status === kakao.maps.services.Status.OK) {
          categoryResults = categoryResults.concat(data);

          // Retrieve up to 3 pages
          if (pagination.hasNextPage && pagination.current < 3) {
            pagination.nextPage();
          } else {
            combinedResults = combinedResults.concat(categoryResults);
            pendingCategories--;
            if (pendingCategories === 0) {
              renderNearbyPlaces(combinedResults);
              resetSearchNearbyBtn();
            }
          }
        } else {
          // No more results or error -> wrap up this category
          combinedResults = combinedResults.concat(categoryResults);
          pendingCategories--;
          if (pendingCategories === 0) {
            renderNearbyPlaces(combinedResults);
            resetSearchNearbyBtn();
          }
        }
      };

      // Search with radius of 1.5km
      ps.categorySearch(categoryCode, pageCallback, { location: loc, radius: 1500, page: 1 });
    };

    // Trigger searches concurrently
    fetchCategoryPages('FD6'); // Restaurants
    fetchCategoryPages('CE7'); // Cafes
  });
};

function resetSearchNearbyBtn() {
  const searchBtn = document.getElementById('search-nearby-btn');
  if (searchBtn) {
    searchBtn.disabled = false;
    searchBtn.querySelector('span').textContent = 'search';
    searchBtn.querySelector('span').style.animation = '';
  }
}

// Clear and hide nearby search markers
window.clearNearbyPlaces = function() {
  if (nearbyPlacesLayerGroup) {
    nearbyPlacesLayerGroup.clearLayers();
  }
  const clearBtn = document.getElementById('clear-nearby-btn');
  if (clearBtn) {
    clearBtn.classList.add('hidden');
  }
  showToast("주변 검색 마커를 숨겼습니다.", "info");
};

// Render Unregistered Real Places on Map
function renderNearbyPlaces(places) {
  if (!nearbyPlacesLayerGroup) return;
  nearbyPlacesLayerGroup.clearLayers();

  let renderedCount = 0;

  places.forEach(place => {
    // Check if it is already registered (either by name or very close lat/lng)
    const lat = parseFloat(place.y);
    const lng = parseFloat(place.x);
    
    const alreadyRegistered = gourmets.some(g => 
      g.name.includes(place.place_name) || 
      (Math.abs(g.lat - lat) < 0.0001 && Math.abs(g.lng - lng) < 0.0001)
    );

    if (alreadyRegistered) return; // Skip if already registered

    // Icon style for unregistered places (grey hollow pin)
    const customIcon = L.divIcon({
      className: 'custom-marker-container',
      html: `
        <div class="custom-marker-pin" style="background-color: #8e8e93; color: #8e8e93; border: 2px solid #ffffff; box-shadow: 0 2px 6px rgba(0,0,0,0.15);">
          <span class="material-symbols-rounded pin-icon" style="font-size: 16px; color: #ffffff; font-variation-settings: 'FILL' 1;">add_location_alt</span>
        </div>
      `,
      iconSize: [26, 36],
      iconAnchor: [13, 36],
      popupAnchor: [0, -36]
    });

    const marker = L.marker([lat, lng], { icon: customIcon });

    // HTML popup inside the map marker
    const popupHtml = `
      <div class="popup-content-box" style="text-align: center; padding: 4px; min-width: 160px;">
        <h4 style="font-size: 13px; font-weight: 700; margin-bottom: 2px; color: var(--text-main);">${place.place_name}</h4>
        <p style="font-size: 11px; color: var(--text-secondary); margin-bottom: 8px; line-height: 1.4;">${place.road_address_name || place.address_name}</p>
        <button class="popup-btn" style="background-color: var(--primary-color); border: none; border-radius: 4px; padding: 6px 12px; color: #ffffff !important; font-size: 11px; font-weight: 600; cursor: pointer; width: 100%; transition: 0.2s;" 
          onclick="openAddModalForRealPlace('${place.place_name.replace(/'/g, "\\'")}', '${(place.road_address_name || place.address_name).replace(/'/g, "\\'")}', ${lat}, ${lng}, '${place.category_name.replace(/'/g, "\\'")}')">
          내 맛집으로 등록
        </button>
      </div>
    `;

    marker.bindPopup(popupHtml);
    nearbyPlacesLayerGroup.addLayer(marker);
    renderedCount++;
  });

  if (renderedCount > 0) {
    const clearBtn = document.getElementById('clear-nearby-btn');
    if (clearBtn) {
      clearBtn.classList.remove('hidden');
    }
    showToast(`주변의 실제 장소 ${renderedCount}곳을 불러왔습니다. 회색 마커를 클릭해 내 맛집으로 등록하세요!`, "success");
  } else {
    const clearBtn = document.getElementById('clear-nearby-btn');
    if (clearBtn) {
      clearBtn.classList.add('hidden');
    }
    showToast("주변에 등록되지 않은 새로운 실제 맛집이 없습니다.", "info");
  }
}

// Open modal with pre-filled fields for a real place
window.openAddModalForRealPlace = function(name, address, lat, lng, categoryName) {
  // Map Kakao category to local categories
  let category = '기타';
  if (categoryName.includes('한식') || categoryName.includes('국밥') || categoryName.includes('찌개')) category = '한식';
  else if (categoryName.includes('중식') || categoryName.includes('중화요리')) category = '중식';
  else if (categoryName.includes('일식') || categoryName.includes('초밥') || categoryName.includes('돈까스')) category = '일식';
  else if (categoryName.includes('양식') || categoryName.includes('이탈리안') || categoryName.includes('피자') || categoryName.includes('파스타')) category = '양식';
  else if (categoryName.includes('카페') || categoryName.includes('커피') || categoryName.includes('디저트') || categoryName.includes('제과')) category = '카페';

  // Open modal and pre-fill form
  document.getElementById('form-name').value = name;
  document.getElementById('form-address').value = address;
  document.getElementById('form-lat').value = lat;
  document.getElementById('form-lng').value = lng;
  document.getElementById('form-category').value = category;

  document.getElementById('form-date').value = new Date().toISOString().split('T')[0];
  
  // Close map popup
  map.closePopup();
  
  openModal('add-modal');
};

// Map Click Handler -> Open Add Form
function onMapClick(e) {
  if (!currentUser) return; // Prevent action if logged out

  const lat = e.latlng.lat;
  const lng = e.latlng.lng;

  // Reset Kakao search fields
  document.getElementById('kakao-search-input').value = '';
  const resultsContainer = document.getElementById('kakao-search-results');
  resultsContainer.innerHTML = '';
  resultsContainer.classList.add('hidden');

  document.getElementById('form-lat').value = lat;
  document.getElementById('form-lng').value = lng;
  
  document.getElementById('form-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('form-address').value = '주소를 가져오는 중...';

  openModal('add-modal');

  // Reverse Geocoding with OSM Nominatim API
  fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`)
    .then(res => res.json())
    .then(data => {
      const address = data.display_name || `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
      document.getElementById('form-address').value = address;
    })
    .catch(err => {
      console.error(err);
      document.getElementById('form-address').value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    });
}

// Save New Gourmet (Supabase insertion with user_id)
window.saveGourmet = async function(e) {
  e.preventDefault();
  if (!currentUser) return;

  const name = document.getElementById('form-name').value.trim();
  const category = document.getElementById('form-category').value;
  const address = document.getElementById('form-address').value.trim();
  const img = document.getElementById('form-img').value.trim() || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=600&auto=format&fit=crop&q=80';
  const memo = document.getElementById('form-memo').value.trim();
  const lat = parseFloat(document.getElementById('form-lat').value);
  const lng = parseFloat(document.getElementById('form-lng').value);
  
  const visited = document.getElementById('form-visited').value === 'true';
  let rating = 1;
  let date = '';
  
  if (visited) {
    date = document.getElementById('form-date').value;
    const checkedRating = document.querySelector('input[name="rating"]:checked');
    if (checkedRating) {
      rating = parseInt(checkedRating.value);
    }
  }

  const newGourmet = {
    name,
    category,
    lat,
    lng,
    address,
    visited,
    rating,
    date,
    img,
    memo,
    user_id: currentUser.id // Explicit user ownership binding
  };

  // Close modal, reset form
  closeModal('add-modal');
  document.getElementById('add-form').reset();
  toggleVisitedFormFields('false');

  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from('gourmets')
        .insert([newGourmet])
        .select();

      if (error) throw error;
      
      if (data && data[0]) {
        gourmets.push(data[0]);
      } else {
        newGourmet.id = Date.now();
        gourmets.push(newGourmet);
      }
      saveToLocalStorage();
      showToast("맛집이 저장되었습니다!", "success");
    } catch (err) {
      console.error("Supabase insert failed. Saving locally:", err);
      newGourmet.id = Date.now();
      newGourmet.created_at = new Date().toISOString();
      gourmets.push(newGourmet);
      saveToLocalStorage();
      showToast("맛집 로컬 저장 완료 (오프라인)", "info");
    }
  } else {
    newGourmet.id = Date.now();
    newGourmet.created_at = new Date().toISOString();
    gourmets.push(newGourmet);
    saveToLocalStorage();
    showToast("맛집 로컬 저장 완료", "info");
  }
  
  filterAndRender();
};

// Toggle Visited Form Fields inside Registration
window.toggleVisitedFormFields = function(val) {
  const container = document.getElementById('visited-fields-container');
  if (val === 'true') {
    container.classList.remove('hidden');
  } else {
    container.classList.add('hidden');
  }
};

// Render Map Markers based on current filter state
function renderMarkers(items) {
  if (!markerClusterGroup) return;
  markerClusterGroup.clearLayers();
  currentMarkers = {};

  items.forEach(item => {
    const iconClass = item.visited ? 'marker-visited' : 'marker-want-to-go';
    const iconName = categoryIcons[item.category] || 'restaurant';

    const customIcon = L.divIcon({
      className: 'custom-marker-container',
      html: `
        <div class="custom-marker-pin ${iconClass}">
          <span class="material-symbols-rounded pin-icon">${iconName}</span>
        </div>
      `,
      iconSize: [32, 42],
      iconAnchor: [16, 42],
      popupAnchor: [0, -42]
    });

    const marker = L.marker([item.lat, item.lng], { icon: customIcon });

    const popupHtml = `
      <div class="popup-content-box">
        <h4>${item.name}</h4>
        <p>${item.category} | ${item.visited ? '방문 완료' : '가고 싶은 곳'}</p>
        <button class="popup-btn" onclick="openDetailModal(${item.id})">상세 정보 보기</button>
      </div>
    `;

    marker.bindPopup(popupHtml);
    markerClusterGroup.addLayer(marker);
    currentMarkers[item.id] = marker;
  });
}

// Render Sidebar List Card
function renderSidebarList() {
  const listEl = document.getElementById('gourmet-list');
  const countEl = document.getElementById('results-count-num');
  if (!listEl) return;
  listEl.innerHTML = '';

  const filtered = getFilteredGourmets();
  
  // Sort
  if (activeSort === 'recent') {
    filtered.sort((a, b) => new Date(b.created_at || b.id) - new Date(a.created_at || a.id));
  } else if (activeSort === 'rating') {
    filtered.sort((a, b) => b.rating - a.rating);
  }

  countEl.textContent = filtered.length;

  if (filtered.length === 0) {
    listEl.innerHTML = `
      <div class="empty-list-placeholder">
        <span class="material-symbols-rounded">search_off</span>
        <p>조건에 맞는 맛집이 없습니다.</p>
      </div>
    `;
    return;
  }

  filtered.forEach(item => {
    const li = document.createElement('li');
    li.className = 'gourmet-card';
    li.dataset.id = item.id;
    li.addEventListener('click', () => selectGourmet(item));

    li.innerHTML = `
      <div class="card-header-row">
        <span class="card-category">${item.category}</span>
        <span class="card-visited-badge ${item.visited ? 'visited' : 'want-to-go'}">
          ${item.visited ? '방문 완료' : '가보고 싶음'}
        </span>
      </div>
      <h3 class="card-title">${item.name}</h3>
      <div class="card-address">
        <span class="material-symbols-rounded">location_on</span>
        <span>${item.address ? item.address.substring(0, 24) : ''}${item.address && item.address.length > 24 ? '...' : ''}</span>
      </div>
      ${item.visited ? `
        <div class="card-footer-row">
          <div class="card-rating">
            <span class="material-symbols-rounded star-icon" style="font-variation-settings: 'FILL' 1;">star</span>
            <span class="rating-value">${item.rating}.0</span>
          </div>
          <span class="card-date">${item.date || ''}</span>
        </div>
      ` : ''}
    `;

    listEl.appendChild(li);
  });
}

// Select Card -> Zoom Map and open Marker popup
function selectGourmet(item) {
  document.querySelectorAll('.gourmet-card').forEach(card => card.classList.remove('selected'));
  const selectedCard = document.querySelector(`.gourmet-card[data-id="${item.id}"]`);
  if (selectedCard) {
    selectedCard.classList.add('selected');
  }

  map.setView([item.lat, item.lng], 16);

  const marker = currentMarkers[item.id];
  if (marker) {
    markerClusterGroup.zoomToShowLayer(marker, () => {
      marker.openPopup();
    });
  }
}

// Filter and Render Combine
function filterAndRender() {
  const filtered = getFilteredGourmets();
  renderMarkers(filtered);
  renderSidebarList();
}

// Filter core logic
function getFilteredGourmets() {
  const query = document.getElementById('search-input').value.toLowerCase().trim();
  const category = document.getElementById('category-filter').value;
  const status = document.getElementById('status-filter').value;

  return gourmets.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(query) || (item.address && item.address.toLowerCase().includes(query));
    const matchesCategory = category === 'ALL' || item.category === category;
    
    let matchesStatus = true;
    if (status === 'VISITED') {
      matchesStatus = item.visited === true;
    } else if (status === 'WANT_TO_GO') {
      matchesStatus = item.visited === false;
    }

    return matchesSearch && matchesCategory && matchesStatus;
  });
}

// Sort Tabs change
function changeSort(type) {
  activeSort = type;
  document.getElementById('sort-recent-btn').classList.toggle('active', type === 'recent');
  document.getElementById('sort-rating-btn').classList.toggle('active', type === 'rating');
  renderSidebarList();
}

// Modal Open Helper
window.openModal = function(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove('hidden');
};

// Modal Close Helper
window.closeModal = function(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.add('hidden');
};

// Detail Modal View & Click handlers for live inline editing
window.openDetailModal = function(id) {
  const item = gourmets.find(g => g.id === id);
  if (!item) return;

  document.getElementById('detail-category').textContent = item.category;
  document.getElementById('detail-name').textContent = item.name;
  document.getElementById('detail-address').textContent = item.address || '';
  
  const imgBox = document.getElementById('detail-img-box');
  const imgEl = document.getElementById('detail-img');
  if (item.img) {
    imgEl.src = item.img;
    imgBox.style.display = 'block';
  } else {
    imgBox.style.display = 'none';
  }

  const statusBadge = document.getElementById('detail-visited-badge');
  const visitSection = document.getElementById('detail-visit-section');
  const toggleBtn = document.getElementById('detail-toggle-visit-btn');

  // Input elements for inline editing
  const dateInput = document.getElementById('detail-date-input');
  const memoInput = document.getElementById('detail-memo-input');

  // Load current values
  dateInput.value = item.date || new Date().toISOString().split('T')[0];
  memoInput.value = item.memo || '';

  // Setup dynamic listeners for inline changes
  setupInlineEditListeners(item);

  if (item.visited) {
    statusBadge.textContent = '방문 완료';
    statusBadge.className = 'visited-status-badge visited';
    visitSection.style.display = 'block';
    
    // Render clickable rating stars
    renderClickableStars(item);
    
    toggleBtn.textContent = '가고 싶은 곳으로 변경';
    toggleBtn.className = 'btn btn-secondary';
  } else {
    statusBadge.textContent = '가고 싶은 곳';
    statusBadge.className = 'visited-status-badge want-to-go';
    visitSection.style.display = 'none';
    toggleBtn.textContent = '방문한 곳으로 표시';
    toggleBtn.className = 'btn btn-primary';
  }

  // Trigger modal deletion confirmation instead of native confirm
  document.getElementById('detail-delete-btn').onclick = () => {
    deleteTargetId = item.id;
    openModal('delete-confirm-modal');
  };

  toggleBtn.onclick = () => toggleGourmetVisited(item.id);

  map.closePopup();
  openModal('detail-modal');
};

// Render Clickable Star Ratings inside Detail Modal
function renderClickableStars(item) {
  const container = document.getElementById('detail-stars-rating');
  if (!container) return;
  container.innerHTML = '';

  // Create 5 stars
  for (let i = 5; i >= 1; i--) {
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'detail-rating-radio';
    input.id = `detail-star${i}`;
    input.value = i;
    if (i === item.rating) input.checked = true;

    // Save changes when clicked
    input.addEventListener('change', () => {
      saveInlineFieldUpdate(item.id, { rating: i }, "평점이 저장되었습니다.");
    });

    const label = document.createElement('label');
    label.setAttribute('for', `detail-star${i}`);
    label.className = 'material-symbols-rounded';
    label.textContent = 'star';
    label.style.fontSize = '24px';

    container.appendChild(input);
    container.appendChild(label);
  }
}

// Bind live update listeners on inputs in detail modal
function setupInlineEditListeners(item) {
  const dateInput = document.getElementById('detail-date-input');
  const memoInput = document.getElementById('detail-memo-input');

  // Clone node elements to remove previous event listeners
  const newDateInput = dateInput.cloneNode(true);
  const newMemoInput = memoInput.cloneNode(true);
  dateInput.parentNode.replaceChild(newDateInput, dateInput);
  memoInput.parentNode.replaceChild(newMemoInput, memoInput);

  // Bind change listeners to save inputs automatically
  newDateInput.addEventListener('change', () => {
    saveInlineFieldUpdate(item.id, { date: newDateInput.value }, "방문 날짜가 저장되었습니다.");
  });

  newMemoInput.addEventListener('change', () => {
    saveInlineFieldUpdate(item.id, { memo: newMemoInput.value.trim() }, "메모가 저장되었습니다.");
  });
}

// Inline DB/localStorage Field Save Updates
async function saveInlineFieldUpdate(id, updateObj, toastMsg) {
  if (!currentUser) return;
  
  const index = gourmets.findIndex(g => g.id === id);
  if (index === -1) return;

  // Local state update
  gourmets[index] = { ...gourmets[index], ...updateObj };
  saveToLocalStorage();
  renderSidebarList();
  
  // Flash success toast
  showToast(toastMsg, "success");

  if (supabaseClient) {
    try {
      const { error } = await supabaseClient
        .from('gourmets')
        .update(updateObj)
        .eq('id', id)
        .eq('user_id', currentUser.id);

      if (error) throw error;
      console.log(`Inline field update saved to DB: ${JSON.stringify(updateObj)}`);
    } catch (err) {
      console.error("Supabase inline update failed:", err);
    }
  }
}

// Toggle Visited Status (Supabase integration with automatic inline default setting)
async function toggleGourmetVisited(id) {
  if (!currentUser) return;
  const index = gourmets.findIndex(g => g.id === id);
  if (index === -1) return;

  const item = gourmets[index];
  let updatedData = {};
  
  if (!item.visited) {
    // Defaults to 5 stars, today's date when toggling to visited
    // No native prompt popups! User can immediately change it in the UI
    updatedData = { 
      visited: true, 
      rating: 5, 
      date: new Date().toISOString().split('T')[0] 
    };
    showToast("방문 완료로 등록되었습니다! 평점과 날짜는 상세페이지에서 변경이 가능합니다.", "success");
  } else {
    updatedData = { visited: false, rating: 1, date: '' };
    showToast("가보고 싶은 곳으로 변경되었습니다.", "info");
  }

  // Update in memory & view
  gourmets[index] = { ...item, ...updatedData };
  saveToLocalStorage();
  closeModal('detail-modal');
  filterAndRender();

  if (supabaseClient) {
    try {
      const { error } = await supabaseClient
        .from('gourmets')
        .update(updatedData)
        .eq('id', id)
        .eq('user_id', currentUser.id);
      
      if (error) throw error;
    } catch (err) {
      console.error("Failed to update visited in Supabase:", err);
    }
  }
}

// Confirm Delete from custom Modal (Triggered by confirm button in modal 4)
async function confirmDeleteGourmet() {
  if (deleteTargetId === null || !currentUser) return;

  const id = deleteTargetId;
  deleteTargetId = null;

  // Close modals
  closeModal('delete-confirm-modal');
  closeModal('detail-modal');

  // Optimistic UI updates
  gourmets = gourmets.filter(g => g.id !== id);
  saveToLocalStorage();
  filterAndRender();
  showToast("맛집이 리스트에서 완전히 삭제되었습니다.", "success");

  if (supabaseClient) {
    try {
      const { error } = await supabaseClient
        .from('gourmets')
        .delete()
        .eq('id', id)
        .eq('user_id', currentUser.id);

      if (error) throw error;
      console.log(`Gourmet ID ${id} deleted successfully from DB.`);
    } catch (err) {
      console.error("Failed to delete from Supabase:", err);
    }
  }
}

// Bootstrap Initialization
document.addEventListener('DOMContentLoaded', initApp);
