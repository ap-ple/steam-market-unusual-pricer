// ==UserScript==
// @name         Steam Market Unusual Pricer
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Displays backpack.tf page links, suggested prices, and profit margins for each effect of an unusual item on the Steam Community Market
// @author       ncrohawk
// @match        https://steamcommunity.com/market/listings/440/*Unusual*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=steamcommunity.com
// @grant        GM_xmlhttpRequest

// ==/UserScript==

(async function() {
    'use strict';

    const goodMargin = 0.20;

    const marketplaceKeyPrice = 1.9;

    const strangeQuality = "11";

    const icons = document.createElement("link");
    document.head.appendChild(icons);
    icons.rel = "stylesheet";
    icons.href = "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&icon_names=progress_activity,warning";

    const itemInfoHiderRule = document.createElement("style");
    document.head.appendChild(itemInfoHiderRule);
    itemInfoHiderRule.textContent = `
        .market_listing_iteminfo_hider:has(:checked) + .market_listing_iteminfo {
            display: none;
        }`;

    const itemInfo = document.querySelector(".market_listing_iteminfo");

    const itemInfoHider = document.createElement("label");
    itemInfo.before(itemInfoHider);
    itemInfoHider.textContent = "Hide item info";
    itemInfoHider.className = "market_listing_iteminfo_hider";
    itemInfoHider.style.userSelect = "none";

    const itemInfoHiderCheckbox = document.createElement("input");
    itemInfoHider.prepend(itemInfoHiderCheckbox);
    itemInfoHiderCheckbox.type = "checkbox";
    itemInfoHiderCheckbox.checked = true;

    document.addEventListener("keydown", event => {
        switch (event.key) {
            case "ArrowLeft": return searchResults_btn_prev.click();
            case "ArrowRight": return searchResults_btn_next.click();
        }
    });

    if (!localStorage.getItem("arrowKeyNavigationAcknowledged")) {
        const arrowKeyNavigationTip = document.createElement("dialog");
        searchResults_controls.appendChild(arrowKeyNavigationTip);
        searchResults_controls.addEventListener("mouseenter", () => arrowKeyNavigationTip.show());
        arrowKeyNavigationTip.textContent = "You can use arrow keys to navigate pages";
        Object.assign(arrowKeyNavigationTip.style, {
            borderRadius: "12px",
            borderColor: "transparent",
            background: "#dbdbdb",
        });
        const arrowKeyNavigationTipAcknowledge = document.createElement("button");
        arrowKeyNavigationTip.appendChild(arrowKeyNavigationTipAcknowledge);
        arrowKeyNavigationTipAcknowledge.textContent = "Ok";
        arrowKeyNavigationTipAcknowledge.style.marginLeft = "8px";
        arrowKeyNavigationTipAcknowledge.addEventListener("click", () => {
            arrowKeyNavigationTip.remove();
            localStorage.setItem("arrowKeyNavigationAcknowledged", "true");
        });
    }

    const itemIsStrange = window.location.href.includes("/Strange");

    if (itemIsStrange) {
        const heading = document.querySelector(".market_section_title");
        const warning = document.createElement("span");
        heading.appendChild(warning);
        warning.className = "material-symbols-outlined";
        warning.title = "Suggested prices displayed are for non-strange items";
        warning.textContent = "warning";
        warning.style.color = "#EAC452";
        warning.style.cursor = "help";
        warning.style.translate = "2px 2px";
    }

    const itemName = window.location.href.match(/(?<=Unusual%20).*/)[0];
    const backpackURL = `https://backpack.tf/stats/Unusual/${itemName}/Tradable/Craftable/`;

    const marketTax = 1.15;

    const keyUSDPrice = await getKeyUSDPrice();
    const keyUSDPriceTaxed = keyUSDPrice / marketTax;

    const sleep = (milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds));

    async function getKeyUSDPrice() {
        const url = new URL("https://steamcommunity.com/market/itemordershistogram");

        url.searchParams.set("language", "english");
        url.searchParams.set("currency", "1"); // USD
        url.searchParams.set("item_nameid", "1"); // key

        const response = await fetch(url.toString());

        const data = await response.json();

        return parseFloat(data.buy_order_graph[0][0]);
    }
    async function getUnusualStats(url) {
        let page;
        let delay = 0;

        while (!page) {
            await sleep(delay);

            delay = 1000;

            const response = await new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: "GET",
                    url,

                    onload: response => resolve(response),
                    onerror: reject
                });
            });

            if (response.status === 200) {
                page = new DOMParser().parseFromString(response.responseText, "text/html");
            }
        }

        const priceBox = page.querySelector(".price-box");

        const [sellOrders, buyOrders, proposedPrices] = [...page.querySelectorAll(".col-md-6")];

        let suggestedPrice;

        if (priceBox?.title === "backpack.tf Community") {
            suggestedPrice = priceBox.querySelector(".value").textContent.trim();
        }

        const proposedPrice = proposedPrices?.querySelector(".price-new")?.textContent.trim();

        let firstSellOrderPrice;

        const firstSellOrder = sellOrders.querySelector(".item")

        if (firstSellOrder) {
            if (!firstSellOrder.dataset.spell_1 && ((firstSellOrder.dataset.quality_elevated === strangeQuality) === itemIsStrange)) {
                const firstSellOrderText = firstSellOrder.querySelector(".bottom-right span");
                firstSellOrderPrice = parseFloat(firstSellOrderText.textContent.replace("$", ""));

                if (!firstSellOrder.dataset.listing_price) {
                    firstSellOrderPrice /= marketplaceKeyPrice;
                }
            }
        }

        return {
            suggestedPrice,
            proposedPrice,
            firstSellOrderPrice,
            //firstBuyOrderPrice
        };
    }
    async function getPriceIndex(url) {
        const responseText = await new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url,

                onload: res => resolve(res.responseText),
                onerror: reject
            });
        });

        const page = new DOMParser().parseFromString(responseText, "text/html");

        const item = page.querySelector("[data-priceindex]");
        return item.dataset.priceindex;
    }

    const listingStatsCache = {};

    async function priceCheck() {
        const listings = [...searchResultsRows.querySelectorAll(".market_recent_listing_row")];

        let index = 0;

        await Promise.all(listings.map(async (listing) => {
            const listingBuyButton = listing.querySelector(".market_listing_buy_button a");

            listing.style.transition = "opacity 150ms";

            if (!listingBuyButton) {
                listing.style.opacity = 0.5
                return;
            }

            const listingHeader = listing.querySelector(".market_listing_item_name_block");
            Object.assign(listingHeader.style, {
                display: "flex",
                gap: "6px",
            });

            const itemID = listingBuyButton.href.match(/(\d+)(?!.*\d)/)[0];
            const listingEffectName = g_rgAssets[440][2][itemID].descriptions // g_rgAssets is a global variable on the market page which contains information about each listing currently on the page
                .map(description => description.value)
                .find(value => value.includes("Unusual Effect"))
                .split(": ")[1];

            const listingName = listingHeader.querySelector(".market_listing_item_name");
            listingName.textContent = listingName.textContent.replace("Unusual", listingEffectName);
            Object.assign(listingName.style, {
                marginRight: "-8px",
                overflow: "hidden",
                textOverflow: "ellipses",
            });

            const listingPriceElement = listing.querySelector(".market_listing_price_with_fee");
            const listingUSDPrice = parseFloat(listingPriceElement.innerText.replace(",", "").replace("$", ""));
            const listingKeyPrice = listingUSDPrice / keyUSDPriceTaxed;
            const listingKeyPriceString = listingKeyPrice.toFixed(2) + " keys";
            listingPriceElement.textContent = listingPriceElement.textContent.trim();
            listingPriceElement.textContent += `\n(${listingKeyPriceString})`;
            listingPriceElement.style.whiteSpace = "pre";

            let listingEffect = localStorage.getItem(listingEffectName);

            if (!listingEffect) {
                const effectURL = "https://backpack.tf/effect/" + encodeURIComponent(listingEffectName);
                listingEffect = await getPriceIndex(effectURL);
                localStorage.setItem(listingEffectName, listingEffect);
            }

            const listingBackpackURL = backpackURL + listingEffect;

            const listingBackpackAnchor = document.createElement("a");
            listingHeader.appendChild(listingBackpackAnchor);
            Object.assign(listingBackpackAnchor, {
                href: listingBackpackURL,
                target: "_blank",
                title: "backpack.tf Stats",
            });
            Object.assign(listingBackpackAnchor.style, {
                backgroundImage: "url('https://www.google.com/s2/favicons?sz=64&domain=backpack.tf')",
                width: "16px",
                aspectRatio: 1,
                display: "flex",
                backgroundSize: "contain",
                flexShrink: 0,
            });

            const loader = document.createElement("span");
            listingHeader.appendChild(loader);
            loader.className = "material-symbols-outlined";
            loader.textContent = "progress_activity";
            loader.style.fontSize = "16px";

            loader.animate([
                { rotate: "0deg" },
                { rotate: "360deg" }
            ], {
                duration: 1000,
                iterations: Infinity
            });

            await sleep(index++); // ensures each listing is checked in order thereby allowing multiple listings of same effect to be checked at once since it will await whatever is in the cache

            if (!listingStatsCache[listingEffect]) {
                listingStatsCache[listingEffect] = getUnusualStats(listingBackpackURL);
            }

            let listingStats = await listingStatsCache[listingEffect];

            loader.remove();

            if (listingStats.proposedPrice) {
                const listingSuggestedPrice = document.createElement("div");
                listingHeader.appendChild(listingSuggestedPrice);
                listingSuggestedPrice.textContent = listingStats.suggestedPrice;
                listingSuggestedPrice.title = "backpack.tf Suggested Price";
                listingSuggestedPrice.style.cursor = "help";

                if (!listingStats.suggestedPrice) {
                    listingSuggestedPrice.textContent = listingStats.proposedPrice;
                    listingSuggestedPrice.title = "backpack.tf Proposed Price";
                    //listingSuggestedPrice.style.fontStyle = "italic";
                    listingSuggestedPrice.style.textDecoration = "underline dotted";
                }
            }

            if (listingStats.firstSellOrderPrice) {
                const differenceIndicator = document.createElement("div");
                listingHeader.appendChild(differenceIndicator);
                differenceIndicator.title = "Maximum profit margin";
                differenceIndicator.style.cursor = "help";
                differenceIndicator.style.color = "#5B5B5B";

                const lowestSellOrder = parseFloat(listingStats.firstSellOrderPrice);
                const difference = lowestSellOrder - listingKeyPrice;
                const percentDifference = difference / listingKeyPrice;
                const percentDifferenceString = percentDifference
                .toLocaleString('en-US', {
                    style: 'percent',
                    minimumFractionDigits: 2
                });

                if (difference > 0) {
                    differenceIndicator.textContent = percentDifferenceString + " 🡅";
                    if (percentDifference >= goodMargin) differenceIndicator.style.color = "#2fd65c";
                }
                else {
                    listing.style.opacity = 0.5;
                    listingName.style.textDecoration = "line-through";
                    differenceIndicator.textContent = percentDifferenceString + " 🡇";
                    differenceIndicator.style.color = "#f72525";
                }
            }
        }));
    }

    const listingsObserver = new MutationObserver(() => priceCheck());

    listingsObserver.observe(searchResultsRows, {childList: true});

    priceCheck();
})();