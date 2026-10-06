(() => {
  const readJson = async (response) => {
    const body = await response.text();
    if (!body) {
      throw new Error(
        response.ok
          ? "The raffle service returned no data. Please refresh the page and try again."
          : `Raffle details could not be loaded (HTTP ${response.status}). Please refresh the page or contact the store.`,
      );
    }
    try {
      return JSON.parse(body);
    } catch {
      if (!response.ok) {
        throw new Error(
          `Raffle details could not be loaded (HTTP ${response.status}). Please refresh the page or contact the store.`,
        );
      }
      throw new Error("Raffle details could not be read. Please try again.");
    }
  };

  const formatPrice = (price, currencyCode) => {
    const amount = Number(price);
    if (!Number.isFinite(amount)) return `${price} ${currencyCode}`;
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currencyCode || "USD",
      }).format(amount);
    } catch {
      return `${price} ${currencyCode || ""}`.trim();
    }
  };

  const formatDate = (value) =>
    new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));

  const addText = (parent, tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = text;
    parent.append(element);
    return element;
  };

  const addRules = (parent, raffle) => {
    const section = document.createElement("section");
    section.className = "fairdrop-entry-block__rules";
    addText(section, "h4", "", "Entry rules");
    const list = document.createElement("ul");
    const rules = [
      "One entry per customer account.",
      "A customer account and matching account email are required.",
      "Entries are accepted only during the entry window shown above.",
      "Winners are selected at random and invited to purchase at the regular price. No discount is applied.",
    ];
    if (raffle.rules?.requireVerifiedEmail) rules.push("Your customer account email must be verified.");
    if (raffle.rules?.allowedCountries?.length) {
      rules.push(`Eligible customer account countries: ${raffle.rules.allowedCountries.join(", ")}.`);
    }
    if (raffle.rules?.minAccountAgeDays > 0) {
      rules.push(`Your account must be at least ${raffle.rules.minAccountAgeDays} days old before the raffle was announced.`);
    }
    if (raffle.rules?.requirePhone) rules.push("A phone number must be saved to your customer account.");
    rules.push("Disposable email addresses are not accepted.");
    for (const rule of rules) addText(list, "li", "", rule);
    section.append(list);
    parent.append(section);
  };

  const renderRaffle = (root, raffle) => {
    const card = document.createElement("article");
    card.className = "fairdrop-entry-block__raffle";

    const identity = document.createElement("div");
    identity.className = "fairdrop-entry-block__identity";
    const imageUrl =
      raffle.productImageUrl ||
      raffle.productImageFallback ||
      raffle.variants?.find((variant) => variant.image)?.image?.url;
    let productImage;
    if (imageUrl) {
      productImage = document.createElement("img");
      productImage.className = "fairdrop-entry-block__image";
      productImage.src = imageUrl;
      productImage.alt = raffle.productImageAlt || raffle.productTitle;
      productImage.loading = "lazy";
      identity.append(productImage);
    } else {
      productImage = addText(
        identity,
        "div",
        "fairdrop-entry-block__image-placeholder",
        "Product image unavailable",
      );
      productImage.setAttribute("role", "img");
      productImage.setAttribute("aria-label", `No product image is available for ${raffle.productTitle}`);
    }

    const summary = document.createElement("div");
    summary.className = "fairdrop-entry-block__summary";
    addText(summary, "h3", "fairdrop-entry-block__raffle-name", raffle.title);
    addText(summary, "p", "fairdrop-entry-block__product", raffle.productTitle);
    if (raffle.description) {
      addText(summary, "p", "fairdrop-entry-block__description", raffle.description);
    }
    identity.append(summary);
    card.append(identity);

    const dateRange = document.createElement("section");
    dateRange.className = "fairdrop-entry-block__date-range";
    dateRange.setAttribute("aria-label", "Raffle entry dates");
    addText(dateRange, "h4", "", "Entry window");
    const dateGrid = document.createElement("div");
    dateGrid.className = "fairdrop-entry-block__date-grid";
    for (const [label, value] of [
      ["Entries open", raffle.startsAt],
      ["Entry deadline", raffle.closesAt],
    ]) {
      const date = document.createElement("p");
      addText(date, "span", "", label);
      addText(date, "strong", "", formatDate(value));
      dateGrid.append(date);
    }
    dateRange.append(dateGrid);
    card.append(dateRange);
    addRules(card, raffle);

    const actions = document.createElement("div");
    actions.className = "fairdrop-entry-block__actions";
    actions.dataset.entryUrl = `${root.dataset.entryUrlBase}/${encodeURIComponent(raffle.handle)}/widget`;
    actions.dataset.entryProof = raffle.entryProof;
    card.append(actions);
    return { card, actions, productImage };
  };

  const showMessage = (target, message, kind) => {
    target.querySelectorAll(".fairdrop-entry-block__feedback").forEach((item) => item.remove());
    addText(
      target,
      "p",
      `fairdrop-entry-block__feedback fairdrop-entry-block__${kind}`,
      message,
    );
  };

  const showLoginLink = (root, target, message) => {
    target.replaceChildren();
    addText(target, "p", "fairdrop-entry-block__feedback fairdrop-entry-block__status", message);
    const link = document.createElement("a");
    link.className = "fairdrop-entry-block__button";
    link.href = root.dataset.loginUrl;
    link.textContent = "Log in to enter";
    target.append(link);
  };

  const showEntryForm = (root, raffle, target, productImage) => {
    const availableVariants = raffle.variants || [];
    if (!availableVariants.length) {
      addText(
        target,
        "p",
        "fairdrop-entry-block__feedback fairdrop-entry-block__error",
        "This product currently has no available options for the raffle. Please contact the store.",
      );
      return;
    }

    const form = document.createElement("form");
    form.className = "fairdrop-entry-block__form";

    const selectedVariantId = document.createElement("input");
    selectedVariantId.type = "hidden";
    selectedVariantId.name = "variantId";
    selectedVariantId.value = availableVariants[0].id;
    form.append(selectedVariantId);

    const optionNames = raffle.optionNames || [];
    const visibleOptionNames = optionNames.filter((name) => {
      const values = new Set(
        availableVariants.flatMap((variant) =>
          variant.selectedOptions
            .filter((option) => option.name === name)
            .map((option) => option.value),
        ),
      );
      return values.size > 1 || (values.size === 1 && !values.has("Default Title"));
    });
    const variantChoice = document.createElement("section");
    variantChoice.className = "fairdrop-entry-block__variant-choice";
    if (visibleOptionNames.length) {
      addText(variantChoice, "h4", "", "Choose your options");
    }
    const optionControls = [];
    for (const optionName of visibleOptionNames) {
      const label = addText(
        variantChoice,
        "label",
        "fairdrop-entry-block__option-label",
        optionName,
      );
      const select = document.createElement("select");
      select.name = `option-${optionName}`;
      select.dataset.optionName = optionName;
      select.required = true;
      const values = [...new Set(
        availableVariants.flatMap((variant) =>
          variant.selectedOptions
            .filter((option) => option.name === optionName)
            .map((option) => option.value),
        ),
      )];
      for (const value of values) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        select.append(option);
      }
      const firstOption = availableVariants[0].selectedOptions.find(
        (option) => option.name === optionName,
      );
      if (firstOption) select.value = firstOption.value;
      label.append(select);
      optionControls.push(select);
    }
    const priceNotice = addText(
      variantChoice,
      "p",
      "fairdrop-entry-block__price-notice",
      "",
    );
    form.append(variantChoice);

    const submitButton = document.createElement("button");
    const updateVariant = () => {
      const selectedOptions = Object.fromEntries(
        optionControls.map((select) => [select.dataset.optionName, select.value]),
      );
      const variant = availableVariants.find((candidate) =>
        candidate.selectedOptions.every(
          (option) =>
            !visibleOptionNames.includes(option.name) ||
            selectedOptions[option.name] === option.value,
        ),
      );
      selectedVariantId.value = variant?.id || "";
      for (const select of optionControls) {
        for (const option of select.options) {
          option.disabled = !availableVariants.some((candidate) =>
            candidate.selectedOptions.some(
              (candidateOption) =>
                candidateOption.name === select.dataset.optionName &&
                candidateOption.value === option.value,
            ) &&
            optionControls.every((otherSelect) =>
              otherSelect === select ||
              candidate.selectedOptions.some(
                (candidateOption) =>
                  candidateOption.name === otherSelect.dataset.optionName &&
                  candidateOption.value === otherSelect.value,
              ),
            ),
          );
        }
      }
      if (variant) {
        priceNotice.textContent =
          `If selected as a winner, you can purchase this option for ${formatPrice(variant.price, raffle.currencyCode)}.`;
        if (variant.image?.url) {
          if (!(productImage instanceof HTMLImageElement)) {
            const image = document.createElement("img");
            image.className = "fairdrop-entry-block__image";
            image.loading = "lazy";
            productImage.replaceWith(image);
            productImage = image;
          }
          productImage.src = variant.image.url;
          productImage.alt = variant.image.altText || raffle.productTitle;
        } else if (
          productImage instanceof HTMLImageElement &&
          (raffle.productImageUrl || raffle.productImageFallback)
        ) {
          productImage.src = raffle.productImageUrl || raffle.productImageFallback;
          productImage.alt = raffle.productImageAlt || raffle.productTitle;
        }
      } else {
        priceNotice.textContent = "That combination is unavailable. Please choose another option.";
      }
      submitButton.disabled = !variant;
    };
    optionControls.forEach((select) => select.addEventListener("change", updateVariant));
    updateVariant();

    const nameLabel = addText(form, "label", "", "Your name");
    const nameInput = document.createElement("input");
    nameInput.name = "name";
    nameInput.autocomplete = "name";
    nameInput.maxLength = 120;
    nameInput.required = true;
    nameInput.value = root.dataset.customerName || "";
    nameLabel.append(nameInput);

    const emailLabel = addText(form, "label", "", "Email address on your customer account");
    const emailInput = document.createElement("input");
    emailInput.name = "email";
    emailInput.type = "email";
    emailInput.autocomplete = "email";
    emailInput.maxLength = 254;
    emailInput.required = true;
    emailInput.value = root.dataset.customerEmail || "";
    emailLabel.append(emailInput);

    const timeZoneInput = document.createElement("input");
    timeZoneInput.type = "hidden";
    timeZoneInput.name = "timeZone";
    timeZoneInput.value = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    form.append(timeZoneInput);

    const proofInput = document.createElement("input");
    proofInput.type = "hidden";
    proofInput.name = "entryProof";
    proofInput.value = target.dataset.entryProof || "";
    form.append(proofInput);

    const honeypot = document.createElement("div");
    honeypot.className = "fairdrop-entry-block__honeypot";
    honeypot.setAttribute("aria-hidden", "true");
    const honeypotLabel = addText(honeypot, "label", "", "Leave this field empty");
    const honeypotInput = document.createElement("input");
    honeypotInput.name = "website";
    honeypotInput.tabIndex = -1;
    honeypotInput.autocomplete = "off";
    honeypotLabel.append(honeypotInput);
    form.append(honeypot);

    submitButton.className = "fairdrop-entry-block__button";
    submitButton.type = "submit";
    submitButton.textContent = "Enter raffle";
    form.append(submitButton);
    addText(
      form,
      "small",
      "",
      "One entry per customer account. Winners are invited to buy at the product’s regular price.",
    );
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      target.querySelectorAll(".fairdrop-entry-block__feedback").forEach((item) => item.remove());
      submitButton.disabled = true;
      submitButton.textContent = "Submitting entry…";
      try {
        const response = await fetch(target.dataset.entryUrl, {
          method: "POST",
          body: new FormData(form),
          credentials: "same-origin",
          headers: { Accept: "application/json" },
        });
        const result = await readJson(response);
        if (!response.ok) {
          if (response.status === 401) {
            showLoginLink(root, target, result.error || "Log in to enter this raffle.");
            return;
          }
          showMessage(target, result.error || "Check the details and try again.", "error");
          return;
        }
        if (result.error) {
          showMessage(target, result.error, "error");
          return;
        }
        form.remove();
        const chosenVariant = availableVariants.find(
          (variant) => variant.id === selectedVariantId.value,
        );
        const chosenOptions = chosenVariant?.selectedOptions
          .map((option) => option.value)
          .filter((value) => value !== "Default Title")
          .join(" / ");
        const enteredMessage = chosenOptions
          ? `You're entered for ${chosenOptions}. Good luck!`
          : result.message || "You're in! Good luck.";
        showMessage(target, enteredMessage, "success");
      } catch (error) {
        showMessage(
          target,
          error instanceof Error ? error.message : "We couldn’t submit your entry. Please try again.",
          "error",
        );
      } finally {
        if (submitButton.isConnected) {
          submitButton.textContent = "Enter raffle";
          updateVariant();
        }
      }
    });
    target.append(form);
  };

  const mountWidget = (root) => {
    if (root.dataset.fairdropMounted === "true") return;
    root.dataset.fairdropMounted = "true";
    const content = root.querySelector(".fairdrop-entry-block__content");
    const endpoint = root.dataset.widgetUrl;
    if (!content || !endpoint) return;

    const loadRaffles = async () => {
      content.replaceChildren();
      addText(content, "p", "fairdrop-entry-block__status", "Loading raffle details…");
      try {
        const response = await fetch(endpoint, {
          credentials: "same-origin",
          headers: { Accept: "application/json" },
        });
        const result = await readJson(response);
        if (result.error) throw new Error(result.error);
        if (!response.ok) throw new Error(result.error || "Raffle details could not be loaded.");
        content.replaceChildren();
        if (!result.raffles?.length) {
          addText(content, "p", "fairdrop-entry-block__status", "There are no open raffles right now.");
          return;
        }

        for (const raffle of result.raffles) {
          const { card, actions, productImage } = renderRaffle(root, raffle);
          content.append(card);
          if (!result.customerSignedIn) {
            showLoginLink(root, actions, "Log in to your store customer account to enter this raffle.");
          } else {
            showEntryForm(root, raffle, actions, productImage);
          }
        }
      } catch (error) {
        content.replaceChildren();
        addText(
          content,
          "p",
          "fairdrop-entry-block__feedback fairdrop-entry-block__error",
          error instanceof Error ? error.message : "Raffle details could not be loaded.",
        );
        const retry = document.createElement("button");
        retry.type = "button";
        retry.className = "fairdrop-entry-block__retry";
        retry.textContent = "Try again";
        retry.addEventListener("click", loadRaffles);
        content.append(retry);
      }
    };

    loadRaffles();
  };

  const mountAll = (scope = document) => {
    scope.querySelectorAll("[data-fairdrop-widget]").forEach(mountWidget);
    if (scope.matches?.("[data-fairdrop-widget]")) mountWidget(scope);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => mountAll());
  } else {
    mountAll();
  }
  document.addEventListener("shopify:section:load", (event) => mountAll(event.target));
})();
