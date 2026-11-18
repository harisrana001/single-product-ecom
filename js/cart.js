/**
 * MotoKleen Shared Cart Module (js/cart.js)
 * Single source of truth for cart state, drawer rendering, multi-tab sync, and calculations.
 * Pure Vanilla JS - No build step, no external frameworks.
 */

(function (window) {
    'use strict';

    const STORAGE_KEY = 'motokleen_cart';
    const PROMO_KEY = 'motokleen_promo';
    const FREE_SHIPPING_THRESHOLD = 4000;
    const STANDARD_SHIPPING_FLAT = 200;
    const EXPRESS_SHIPPING_FLAT = 450;
    const MAX_QTY = 10;
    const MIN_QTY = 1;

    // Default product details for easy fallback
    const DEFAULT_PRODUCT = {
        id: 'BK-CLN-KIT',
        name: 'Complete Bike Cleaning & Care Kit',
        variant: 'Complete Care Kit',
        finish: 'Matte Safe',
        price: 2200,
        quantity: 1,
        image: 'img/bike-cleaning-kit.jpg'
    };

    /**
     * Formats numeric amount as Pakistani Rupees (PKR)
     */
    function formatPKR(amount) {
        return 'PKR ' + Math.round(Number(amount) || 0).toLocaleString('en-PK');
    }

    /**
     * Sanitizes string to prevent HTML/XSS injection
     */
    function escapeHTML(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /**
     * Announces cart updates to screen readers
     */
    function announce(message) {
        const el = document.getElementById('cartLiveAnnouncer');
        if (el) {
            el.textContent = message;
        }
    }

    /**
     * MotoKleen Cart Controller Object
     */
    const MotoKleenCart = {
        formatPrice: formatPKR,

        /**
         * Loads items safely from localStorage
         * Handles corrupted JSON, schema verification, and quantity bounds
         */
        getItems: function () {
            try {
                const raw = localStorage.getItem(STORAGE_KEY);
                if (!raw) return [];
                const parsed = JSON.parse(raw);
                if (!Array.isArray(parsed)) return [];
                return parsed.filter(item => {
                    return item && typeof item === 'object' && typeof item.price === 'number' && !isNaN(item.price);
                }).map(item => {
                    const rawPrice = Math.max(0, Number(item.price));
                    // Automatically migrate any legacy USD prices (< 200) to PKR 2,200
                    const normalizedPrice = (rawPrice > 0 && rawPrice < 200) ? DEFAULT_PRODUCT.price : rawPrice;
                    return {
                        id: String(item.id || DEFAULT_PRODUCT.id),
                        name: String(item.name || DEFAULT_PRODUCT.name),
                        variant: String(item.variant || DEFAULT_PRODUCT.variant),
                        finish: String(item.finish || DEFAULT_PRODUCT.finish),
                        price: normalizedPrice,
                        quantity: Math.min(MAX_QTY, Math.max(MIN_QTY, parseInt(item.quantity, 10) || 1)),
                        image: String(item.image || DEFAULT_PRODUCT.image)
                    };
                });
            } catch (err) {
                console.warn('[MotoKleen Cart] Corrupted cart data reset:', err);
                localStorage.removeItem(STORAGE_KEY);
                return [];
            }
        },

        /**
         * Saves items to localStorage and dispatches change events
         */
        saveItems: function (items) {
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
            } catch (err) {
                console.error('[MotoKleen Cart] Failed to save cart to localStorage:', err);
            }
            this.updateUI();
            window.dispatchEvent(new CustomEvent('motokleen:cart-changed', {
                detail: { items: items, totals: this.getTotals() }
            }));
        },

        /**
         * Adds an item to the cart or increments quantity if existing
         */
        addItem: function (item, shouldOpen = true) {
            const items = this.getItems();
            const product = Object.assign({}, DEFAULT_PRODUCT, item);
            const addQty = Math.min(MAX_QTY, Math.max(MIN_QTY, parseInt(product.quantity, 10) || 1));

            // Merge identical items matching variant and finish
            const existingIndex = items.findIndex(function (i) {
                return (i.id === product.id || i.name === product.name) &&
                    i.variant === product.variant &&
                    i.finish === product.finish;
            });

            if (existingIndex > -1) {
                const newQty = Math.min(MAX_QTY, items[existingIndex].quantity + addQty);
                items[existingIndex].quantity = newQty;
                announce(product.name + ' (' + product.variant + ') quantity increased to ' + newQty);
            } else {
                items.push({
                    id: String(product.id),
                    name: String(product.name),
                    variant: String(product.variant),
                    finish: String(product.finish),
                    price: Number(product.price),
                    quantity: addQty,
                    image: String(product.image)
                });
                announce(product.name + ' (' + product.variant + ') added to cart');
            }

            this.saveItems(items);
            if (shouldOpen) {
                try {
                    this.openDrawer();
                } catch (err) {
                    console.error('[MotoKleen Cart] Error opening drawer:', err);
                }
            }
            return items;
        },

        /**
         * Updates quantity for an item at a specific index
         */
        updateQuantity: function (index, newQuantity) {
            const items = this.getItems();
            if (index < 0 || index >= items.length) return items;

            const qty = parseInt(newQuantity, 10);
            if (isNaN(qty) || qty <= 0) {
                return this.removeItem(index);
            }

            const clampedQty = Math.min(MAX_QTY, Math.max(MIN_QTY, qty));
            items[index].quantity = clampedQty;
            announce('Quantity updated to ' + clampedQty);
            this.saveItems(items);
            return items;
        },

        /**
         * Increments / decrements quantity by delta (+1 or -1)
         */
        changeQuantity: function (index, delta) {
            const items = this.getItems();
            if (index < 0 || index >= items.length) return items;
            const newQty = items[index].quantity + delta;
            return this.updateQuantity(index, newQty);
        },

        /**
         * Removes an item by index
         */
        removeItem: function (index) {
            const items = this.getItems();
            if (index < 0 || index >= items.length) return items;
            const removed = items.splice(index, 1);
            if (removed.length > 0) {
                announce(removed[0].name + ' removed from cart');
            }
            this.saveItems(items);
            return items;
        },

        /**
         * Clears all items and active promo
         */
        clear: function () {
            try {
                localStorage.removeItem(STORAGE_KEY);
                localStorage.removeItem(PROMO_KEY);
            } catch (e) {}
            this.updateUI();
            window.dispatchEvent(new CustomEvent('motokleen:cart-changed', {
                detail: { items: [], totals: this.getTotals() }
            }));
            announce('Cart has been cleared');
        },

        /**
         * Gets stored promo code
         */
        getPromo: function () {
            try {
                const code = localStorage.getItem(PROMO_KEY);
                if (code && code.trim().toUpperCase() === 'RIDE10') {
                    return { code: 'RIDE10', rate: 0.10, label: '10% Off' };
                }
            } catch (e) {}
            return null;
        },

        /**
         * Applies a promo code
         */
        applyPromo: function (code) {
            const clean = String(code || '').trim().toUpperCase();
            if (clean === 'RIDE10') {
                try {
                    localStorage.setItem(PROMO_KEY, 'RIDE10');
                } catch (e) {}
                this.updateUI();
                window.dispatchEvent(new CustomEvent('motokleen:cart-changed', {
                    detail: { items: this.getItems(), totals: this.getTotals() }
                }));
                announce('Promo code RIDE10 applied: 10% discount');
                return { success: true, message: 'Code RIDE10 applied! 10% discount applied to your order.' };
            }
            return { success: false, message: 'Invalid promo code. Try "RIDE10" for 10% off.' };
        },

        /**
         * Removes active promo code
         */
        removePromo: function () {
            try {
                localStorage.removeItem(PROMO_KEY);
            } catch (e) {}
            this.updateUI();
            window.dispatchEvent(new CustomEvent('motokleen:cart-changed', {
                detail: { items: this.getItems(), totals: this.getTotals() }
            }));
            announce('Promo code removed');
        },

        /**
         * Calculates complete totals (subtotal, shipping, discount, total)
         */
        getTotals: function (shippingMethod) {
            const items = this.getItems();
            const subtotal = items.reduce(function (sum, item) {
                return sum + (item.price * item.quantity);
            }, 0);

            const itemCount = items.reduce(function (sum, item) {
                return sum + item.quantity;
            }, 0);

            const promo = this.getPromo();
            const discount = promo ? (subtotal * promo.rate) : 0;
            const discountedSubtotal = Math.max(0, subtotal - discount);

            // Shipping calculation
            const method = String(shippingMethod || 'standard').toLowerCase();
            let shipping = 0;
            if (items.length === 0) {
                shipping = 0;
            } else if (method === 'express') {
                shipping = EXPRESS_SHIPPING_FLAT;
            } else {
                // Standard shipping is free at or above PKR 4,000 threshold
                shipping = (subtotal >= FREE_SHIPPING_THRESHOLD) ? 0 : STANDARD_SHIPPING_FLAT;
            }

            const total = (items.length === 0) ? 0 : Math.max(0, discountedSubtotal + shipping);
            const freeShippingRemaining = Math.max(0, FREE_SHIPPING_THRESHOLD - subtotal);
            const freeShippingProgress = Math.min(100, Math.round((subtotal / FREE_SHIPPING_THRESHOLD) * 100));

            return {
                itemCount: itemCount,
                subtotal: subtotal,
                discount: discount,
                promo: promo,
                shippingMethod: method,
                shipping: shipping,
                total: total,
                freeShippingThreshold: FREE_SHIPPING_THRESHOLD,
                freeShippingRemaining: freeShippingRemaining,
                freeShippingProgress: freeShippingProgress,
                isFreeShippingUnlocked: (subtotal >= FREE_SHIPPING_THRESHOLD && items.length > 0)
            };
        },

        /**
         * Opens the Cart Offcanvas Drawer
         */
        openDrawer: function () {
            const drawerEl = document.getElementById('cartDrawer');
            if (!drawerEl) return;

            // Make sure UI is rendered fresh before showing
            this.updateUI();

            // 1. Try Bootstrap Offcanvas (supports Bootstrap 5.0, 5.1, 5.2, 5.3)
            try {
                if (window.bootstrap && window.bootstrap.Offcanvas) {
                    let offcanvas = null;
                    if (typeof window.bootstrap.Offcanvas.getInstance === 'function') {
                        offcanvas = window.bootstrap.Offcanvas.getInstance(drawerEl);
                    }
                    if (!offcanvas && typeof window.bootstrap.Offcanvas.getOrCreateInstance === 'function') {
                        offcanvas = window.bootstrap.Offcanvas.getOrCreateInstance(drawerEl);
                    }
                    if (!offcanvas) {
                        offcanvas = new window.bootstrap.Offcanvas(drawerEl);
                    }
                    if (offcanvas && typeof offcanvas.show === 'function') {
                        offcanvas.show();
                        return;
                    }
                }
            } catch (err) {
                console.warn('[MotoKleen Cart] Bootstrap Offcanvas show failed, using fallback:', err);
            }

            // 2. Pure CSS/DOM fallback for environments where Bootstrap JS failed or is offline
            drawerEl.classList.add('show');
            drawerEl.style.visibility = 'visible';
            if (typeof drawerEl.removeAttribute === 'function') drawerEl.removeAttribute('aria-hidden');
            if (typeof drawerEl.setAttribute === 'function') drawerEl.setAttribute('aria-modal', 'true');

            let backdrop = document.getElementById('cartBackdropFallback');
            if (!backdrop) {
                backdrop = document.createElement('div');
                backdrop.id = 'cartBackdropFallback';
                backdrop.className = 'offcanvas-backdrop fade show';
                backdrop.style.cssText = 'position:fixed;top:0;left:0;z-index:1040;width:100vw;height:100vh;background-color:#000;opacity:0.5;';
                backdrop.onclick = function () {
                    MotoKleenCart.closeDrawer();
                };
                document.body.appendChild(backdrop);
            }
        },

        /**
         * Closes the Cart Offcanvas Drawer
         */
        closeDrawer: function () {
            const drawerEl = document.getElementById('cartDrawer');
            if (!drawerEl) return;

            try {
                if (window.bootstrap && window.bootstrap.Offcanvas) {
                    let offcanvas = null;
                    if (typeof window.bootstrap.Offcanvas.getInstance === 'function') {
                        offcanvas = window.bootstrap.Offcanvas.getInstance(drawerEl);
                    }
                    if (offcanvas && typeof offcanvas.hide === 'function') {
                        offcanvas.hide();
                    }
                }
            } catch (err) {
                console.warn('[MotoKleen Cart] Bootstrap Offcanvas hide failed:', err);
            }

            // Ensure fallback visibility and backdrop are removed
            drawerEl.classList.remove('show');
            drawerEl.style.visibility = 'hidden';
            if (typeof drawerEl.setAttribute === 'function') drawerEl.setAttribute('aria-hidden', 'true');
            if (typeof drawerEl.removeAttribute === 'function') drawerEl.removeAttribute('aria-modal');

            const backdrop = document.getElementById('cartBackdropFallback');
            if (backdrop) {
                backdrop.remove();
            }
        },

        /**
         * Injects shared drawer markup if not present
         */
        injectDrawerMarkup: function () {
            if (!document.getElementById('cartDrawer')) {
                const drawerContainer = document.createElement('div');
                drawerContainer.innerHTML = `
                    <div class="offcanvas offcanvas-end" tabindex="-1" id="cartDrawer" aria-labelledby="cartDrawerLabel" style="width: 440px; max-width: 92vw;" role="dialog" aria-modal="true">
                        <div class="offcanvas-header border-bottom py-3">
                            <h5 class="offcanvas-title fw-bold text-dark d-flex align-items-center" id="cartDrawerLabel">
                                <i class="fa fa-shopping-bag me-2" style="color: var(--accent);"></i>
                                Your Cart (<span id="cartDrawerCount">0</span>)
                            </h5>
                            <button type="button" class="btn-close text-reset shadow-none" data-bs-dismiss="offcanvas" aria-label="Close cart"></button>
                        </div>
                        <div class="offcanvas-body d-flex flex-column p-3">
                            <!-- Free Shipping Tracker -->
                            <div class="bg-light p-3 rounded-3 mb-3 border">
                                <div class="d-flex justify-content-between align-items-center mb-1" style="font-size: 13px;">
                                    <span class="fw-bold text-dark" id="freeShippingText">
                                        <i class="fa fa-truck me-1" style="color: var(--accent);"></i> Add PKR 4,000 for FREE Standard Shipping
                                    </span>
                                    <span id="freeShippingStatus" class="fw-bold text-muted small">0%</span>
                                </div>
                                <div class="progress" style="height: 7px; background: #E5E5E5; border-radius: 4px;">
                                    <div id="freeShippingBar" class="progress-bar progress-bar-striped progress-bar-animated" role="progressbar" style="width: 0%; background: var(--accent);" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100"></div>
                                </div>
                            </div>

                            <!-- Cart Items List -->
                            <div id="cartItemsList" class="flex-grow-1 overflow-auto pe-1" aria-label="Shopping cart items">
                                <!-- Populated dynamically -->
                            </div>

                            <!-- Empty Cart State -->
                            <div id="emptyCartState" class="text-center py-5 d-none my-auto">
                                <div class="mb-3 text-muted">
                                    <i class="fa fa-shopping-cart fa-4x" style="opacity: 0.35;"></i>
                                </div>
                                <h5 class="text-dark fw-bold mb-2">Your Cart Is Empty</h5>
                                <p class="small text-muted mb-4 px-3">Looks like you haven't added the Pro Bike Cleaning Kit to your cart yet.</p>
                                <a href="product.html" class="btn btn-dark btn-sm rounded-pill px-4 py-2 fw-bold">
                                    Shop Detailing Kit &rarr;
                                </a>
                            </div>

                            <!-- Cart Summary & Checkout -->
                            <div id="cartFooterArea" class="border-top pt-3 mt-auto">
                                <div id="cartPromoRow" class="d-none mb-2 justify-content-between text-success small">
                                    <span>Promo Code (RIDE10)</span>
                                    <span id="cartDrawerDiscount">-PKR 0</span>
                                </div>
                                <div class="d-flex justify-content-between align-items-center mb-1">
                                    <span class="text-muted">Subtotal</span>
                                    <span id="cartDrawerSubtotal" class="fw-bold fs-5 text-dark">PKR 0</span>
                                </div>
                                <div class="d-flex justify-content-between align-items-center mb-3 text-muted small">
                                    <span>Standard Shipping</span>
                                    <span id="cartDrawerShippingText" class="fw-bold text-dark">Calculated at checkout</span>
                                </div>
                                <a href="checkout.html" class="btn btn-primary w-100 py-3 rounded-pill fw-bold text-white mb-2 shadow-sm d-flex align-items-center justify-content-center" style="background: var(--accent); border-color: var(--accent);">
                                    <span>Proceed To Checkout</span>
                                    <i class="fa fa-arrow-right ms-2"></i>
                                </a>
                                <div class="text-center small text-muted mt-2 d-flex justify-content-center gap-3">
                                    <span><i class="fa fa-shield-alt text-success me-1"></i> 30-Day Guarantee</span>
                                    <span><i class="fa fa-lock text-success me-1"></i> Secure SSL</span>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
                document.body.appendChild(drawerContainer.firstElementChild);
            }

            // Screen reader live announcer
            if (!document.getElementById('cartLiveAnnouncer')) {
                const announcer = document.createElement('div');
                announcer.id = 'cartLiveAnnouncer';
                announcer.className = 'visually-hidden';
                announcer.setAttribute('aria-live', 'polite');
                announcer.setAttribute('aria-atomic', 'true');
                document.body.appendChild(announcer);
            }
        },

        /**
         * Refreshes all cart UI elements across the page
         */
        updateUI: function () {
            const items = this.getItems();
            const totals = this.getTotals();

            // 1. Update all navbar badges
            const badges = document.querySelectorAll('#navCartBadge, .nav-cart-badge, .cart-nav-badge');
            badges.forEach(function (badge) {
                badge.textContent = totals.itemCount;
                if (totals.itemCount > 0) {
                    badge.style.display = 'inline-block';
                    badge.classList.remove('d-none');
                } else {
                    badge.style.display = 'none';
                    badge.classList.add('d-none');
                }
            });

            // 2. Update Drawer Header Count
            const drawerCount = document.getElementById('cartDrawerCount');
            if (drawerCount) {
                drawerCount.textContent = totals.itemCount;
            }

            // 3. Update Free Shipping Tracker in Drawer
            const freeShippingText = document.getElementById('freeShippingText');
            const freeShippingStatus = document.getElementById('freeShippingStatus');
            const freeShippingBar = document.getElementById('freeShippingBar');

            if (freeShippingText && freeShippingBar && freeShippingStatus) {
                if (totals.isFreeShippingUnlocked) {
                    freeShippingText.innerHTML = '<i class="fa fa-check-circle text-success me-1"></i> <strong>FREE Standard Shipping Unlocked!</strong>';
                    freeShippingStatus.textContent = '100%';
                    freeShippingStatus.className = 'fw-bold text-success small';
                    freeShippingBar.style.width = '100%';
                    freeShippingBar.className = 'progress-bar bg-success';
                } else {
                    freeShippingText.innerHTML = '<i class="fa fa-truck me-1" style="color: var(--accent);"></i> Add <strong>' + formatPKR(totals.freeShippingRemaining) + '</strong> more for FREE Shipping';
                    freeShippingStatus.textContent = totals.freeShippingProgress + '%';
                    freeShippingStatus.className = 'fw-bold text-muted small';
                    freeShippingBar.style.width = totals.freeShippingProgress + '%';
                    freeShippingBar.className = 'progress-bar';
                    freeShippingBar.style.backgroundColor = 'var(--accent)';
                }
            }

            // 4. Update Cart Items List & Empty State
            const listEl = document.getElementById('cartItemsList');
            const emptyEl = document.getElementById('emptyCartState');
            const footerEl = document.getElementById('cartFooterArea');

            if (listEl && emptyEl && footerEl) {
                if (items.length === 0) {
                    listEl.innerHTML = '';
                    emptyEl.classList.remove('d-none');
                    footerEl.classList.add('d-none');
                } else {
                    emptyEl.classList.add('d-none');
                    footerEl.classList.remove('d-none');

                    let html = '';
                    items.forEach(function (item, idx) {
                        const lineTotal = formatPKR(item.price * item.quantity);
                        html += `
                            <div class="card mb-3 border-0 bg-light p-2 rounded-3">
                                <div class="row g-2 align-items-center">
                                    <div class="col-3">
                                        <img src="${escapeHTML(item.image)}" class="img-fluid rounded border" alt="${escapeHTML(item.name)}">
                                    </div>
                                    <div class="col-9">
                                        <div class="d-flex justify-content-between align-items-start mb-1">
                                            <h6 class="mb-0 text-dark fw-bold text-truncate" style="font-size: 13px; max-width: 200px;" title="${escapeHTML(item.name)}">
                                                ${escapeHTML(item.name)}
                                            </h6>
                                            <button type="button" class="btn btn-sm text-muted p-0 ms-2 hover-danger" onclick="MotoKleenCart.removeItem(${idx})" aria-label="Remove ${escapeHTML(item.name)} from cart">
                                                <i class="fa fa-trash-alt"></i>
                                            </button>
                                        </div>
                                        <div class="text-muted small mb-2" style="font-size: 11px;">
                                            <span class="badge bg-white text-dark border me-1">${escapeHTML(item.variant)}</span>
                                            <span class="badge bg-white text-muted border">${escapeHTML(item.finish)}</span>
                                        </div>
                                        <div class="d-flex justify-content-between align-items-center">
                                            <span class="fw-bold text-dark" style="font-size: 14px;">${lineTotal}</span>
                                            <div class="input-group input-group-sm" style="width: 96px;">
                                                <button type="button" class="btn btn-white border px-2 py-0" onclick="MotoKleenCart.changeQuantity(${idx}, -1)" aria-label="Decrease quantity" ${item.quantity <= 1 ? 'disabled' : ''}>-</button>
                                                <span class="form-control text-center bg-white px-1 py-0 fw-bold border-top border-bottom" style="font-size: 13px; max-width: 36px; line-height: 24px;">${item.quantity}</span>
                                                <button type="button" class="btn btn-white border px-2 py-0" onclick="MotoKleenCart.changeQuantity(${idx}, 1)" aria-label="Increase quantity" ${item.quantity >= MAX_QTY ? 'disabled' : ''}>+</button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        `;
                    });
                    listEl.innerHTML = html;
                }
            }

            // 5. Update Subtotal and Promo in Drawer Footer
            const subtotalEl = document.getElementById('cartDrawerSubtotal');
            if (subtotalEl) {
                subtotalEl.textContent = formatPKR(totals.subtotal);
            }

            const promoRow = document.getElementById('cartPromoRow');
            const discountEl = document.getElementById('cartDrawerDiscount');
            if (promoRow && discountEl) {
                if (totals.discount > 0) {
                    promoRow.classList.remove('d-none');
                    promoRow.classList.add('d-flex');
                    discountEl.textContent = '-' + formatPKR(totals.discount);
                } else {
                    promoRow.classList.add('d-none');
                    promoRow.classList.remove('d-flex');
                }
            }

            const shippingText = document.getElementById('cartDrawerShippingText');
            if (shippingText) {
                if (totals.isFreeShippingUnlocked) {
                    shippingText.innerHTML = '<span class="text-success fw-bold">FREE</span>';
                } else {
                    shippingText.textContent = formatPKR(STANDARD_SHIPPING_FLAT);
                }
            }
        },

        /**
         * Initialize module on DOM ready
         */
        init: function () {
            this.injectDrawerMarkup();
            this.updateUI();

            // Multi-tab sync via storage event
            window.addEventListener('storage', (event) => {
                if (event.key === STORAGE_KEY || event.key === PROMO_KEY) {
                    this.updateUI();
                }
            });

            // Auto-bind any elements with data-motokleen-add
            document.addEventListener('click', (e) => {
                const addTrigger = e.target.closest('[data-motokleen-add]');
                if (addTrigger) {
                    e.preventDefault();
                    const variant = addTrigger.getAttribute('data-variant') || DEFAULT_PRODUCT.variant;
                    const price = parseFloat(addTrigger.getAttribute('data-price')) || DEFAULT_PRODUCT.price;
                    const finish = addTrigger.getAttribute('data-finish') || DEFAULT_PRODUCT.finish;
                    this.addItem({
                        id: addTrigger.getAttribute('data-id') || DEFAULT_PRODUCT.id,
                        name: addTrigger.getAttribute('data-name') || DEFAULT_PRODUCT.name,
                        variant: variant,
                        finish: finish,
                        price: price,
                        quantity: 1,
                        image: addTrigger.getAttribute('data-image') || DEFAULT_PRODUCT.image
                    });
                }

                // Open drawer triggers
                const openTrigger = e.target.closest('[data-motokleen-open-cart], .cart-nav-btn');
                if (openTrigger) {
                    e.preventDefault();
                    this.openDrawer();
                }
            });
        }
    };

    // Expose module globally
    window.MotoKleenCart = MotoKleenCart;

    // Helper shortcuts for HTML attributes
    window.openCartDrawer = function () {
        MotoKleenCart.openDrawer();
    };

    window.closeCartDrawer = function () {
        MotoKleenCart.closeDrawer();
    };

    // Auto-init when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            MotoKleenCart.init();
        });
    } else {
        MotoKleenCart.init();
    }

})(window);

