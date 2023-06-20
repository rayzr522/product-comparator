// simple script to allow you to select tabs

const tabsToInclude = new Set()

const tabs = await chrome.tabs.query({ currentWindow: true })
const validTabs = tabs.filter((tab) => tab.url && tab.url.startsWith('https'))

const template = document.getElementById('li_template')
const elements = new Set()
for (const tab of validTabs) {
  const { url, title, id } = tab
  if (!url || !title || !id) continue

  /** @type {HTMLLIElement} */
  const liEl = template.content.firstElementChild.cloneNode(true)
  const pathname = url.toString()

  /** @type {HTMLInputElement} */
  const includeCheckbox = liEl.querySelector('.include')
  includeCheckbox.id = `include-${id}`
  includeCheckbox.addEventListener('click', (e) => {
    if (!e.target.checked) {
      tabsToInclude.delete(id)
    } else {
      tabsToInclude.add(id)
    }
  })

  const titleEl = liEl.querySelector('.title')
  titleEl.textContent = title.trim()
  titleEl['for'] = `include-${id}`

  const urlEl = liEl.querySelector('.url')
  urlEl.textContent = pathname
  urlEl.addEventListener('click', () => {
    chrome.tabs.highlight({ tabs: tab.index })
  })

  titleEl.addEventListener('click', (e) => {
    e.preventDefault()
    includeCheckbox.checked = !includeCheckbox.checked
    if (!includeCheckbox.checked) {
      tabsToInclude.delete(id)
    } else {
      tabsToInclude.add(id)
    }
  })

  // include by default
  includeCheckbox.checked = true
  tabsToInclude.add(id)

  elements.add(liEl)
}
document.querySelector('#tabs').append(...elements)

function getProductPageInfo() {
  function elementIsVisibleInViewport(el, partiallyVisible = false) {
    const { top, left, bottom, right } = el.getBoundingClientRect()
    const { innerHeight, innerWidth } = window
    return partiallyVisible
      ? ((top > 0 && top < innerHeight) ||
        (bottom > 0 && bottom < innerHeight)) &&
      ((left > 0 && left < innerWidth) || (right > 0 && right < innerWidth))
      : top >= 0 && left >= 0 && bottom <= innerHeight && right <= innerWidth
  }
  /** @param {HTMLElement} element @param {'::before' | '::after'} psuedoSelector */
  function getPseudoContent(element, psuedoSelector) {
    const content = getComputedStyle(element, psuedoSelector).getPropertyValue(
      'content'
    )
    if (content === 'none') {
      return ''
    }
    return content.slice(1, -1)
  }
  /** @param {HTMLElement} element */
  function getTextContentWithPseudos(element) {
    const beforeText = getPseudoContent(element, '::before')
    const afterText = getPseudoContent(element, '::after')
    const innerText = element.children.length
      ? [...element.childNodes]
        .map((node) =>
          node instanceof HTMLElement
            ? getTextContentWithPseudos(node)
            : node.textContent ?? ''
        )
        .join('')
      : element.textContent
    return `${beforeText}${innerText}${afterText}`
  }
  /** @param {HTMLElement} element */
  function isHidden(element) {
    let current = element
    while (current) {
      if (
        current.offsetWidth === 0 ||
        current.offsetHeight === 0 ||
        !current.checkVisibility() ||
        current.style.opacity === '0'
      ) {
        return true
      }
      current = current.parentElement
    }
    return false
  }
  /** @param {string} input */
  function coercePriceToNumber(input) {
    return +(input.startsWith('$') ? input.slice(1) : input)
  }
  // only get elements that are likely to have text in them
  const possibleNodes = [
    ...document.querySelectorAll(
      // text elements
      'div,p,span,b,strong,i,em,mark,small,del,ins,sub,sup,h1,h2,h3,h4,h5,h6,blockquote'
    ),
  ]
    .filter(
      (it) =>
        it.textContent !== null &&
        it.textContent.trim().length < 100 &&
        elementIsVisibleInViewport(it)
    )
    .map((node) => {
      return {
        node,
        realTextContent: getTextContentWithPseudos(node).trim(),
      }
    })

  // filter it down to ones that appear to just be numbers, arent struck-thru, and arent hidden
  const likelyNodes = possibleNodes.filter(({ node, realTextContent }) => {
    return (
      /^\$?[0-9]+(\.[0-9]+)?$/.test(realTextContent) &&
      getComputedStyle(node).getPropertyValue('text-decoration-line') !==
      'line-through' &&
      !isHidden(node)
    )
  })

  // filter out elements that are simply parents of other elements in the list
  const deepestNodes = likelyNodes.filter(
    ({ node }) =>
      !likelyNodes.some(
        ({ node: otherNode }) => node !== otherNode && node.contains(otherNode)
      )
  )

  // find the element that is largest on the page, prioritizing elements that appear to be dollar amounts
  const mostLikelyPriceNode = deepestNodes
    .map((it) => {
      try {
        return {
          ...it,
          isDollarAmount:
            it.realTextContent.includes('$') ||
            (it.node.parentElement &&
              getTextContentWithPseudos(it.node.parentElement).includes(
                `$${it.realTextContent}`
              )),
        }
      } catch (e) {
        console.log(it, it.parentElement)
        throw e
      }
    })
    .sort(
      (a, b) =>
        b.isDollarAmount - a.isDollarAmount ||
        b.node.offsetWidth * b.node.offsetHeight -
        a.node.offsetWidth * a.node.offsetHeight
    )[0]

  return {
    title: document.title,
    biggestImage: [...document.querySelectorAll('img')]
      .filter((img) => elementIsVisibleInViewport(img))
      .sort((a, b) => {
        const aRect = a.getBoundingClientRect()
        const bRect = b.getBoundingClientRect()
        return (
          bRect.width * bRect.height -
          bRect.top -
          (aRect.width * aRect.height - aRect.top)
        )
      })[0]?.src,
    price: mostLikelyPriceNode
      ? coercePriceToNumber(mostLikelyPriceNode.realTextContent)
      : null,
    ...((!window.chrome || !chrome.runtime || !chrome.runtime.id) && {
      debug: {
        possibleNodes,
        likelyNodes,
        deepestNodes,
        mostLikelyPriceNode,
      },
    }),
  }
}

const compareProductsButton = document.querySelector('#compare_products')
compareProductsButton.addEventListener('click', async () => {
  compareProductsButton.classList.add('loading')
  try {
    const results = []
    for (const tabId of tabsToInclude) {
      try {
        const result = await chrome.scripting.executeScript({
          func: getProductPageInfo,
          target: { tabId },
        })
        results.push(result[0].result)
      } catch { }
    }
    // document.querySelector(
    //   '#raw_results'
    // ).innerText = `got results: ${JSON.stringify(results, null, 2)}`
    const resultsTable = document.querySelector('#results')
    const resultsBody = resultsTable.querySelector('tbody')
    const resultTemplate = document.getElementById('result_template')
    for (const result of results) {
      /** @type {HTMLLIElement} */
      const resultEl = resultTemplate.content.firstElementChild.cloneNode(true)
      resultEl.querySelector('img').src = result.biggestImage
      resultEl.querySelector('.title').textContent = result.title
      resultEl.querySelector('.price').textContent = `$${result.price}`
      resultsBody.appendChild(resultEl)
    }
    resultsTable.scrollIntoView()
    const type = 'text/html'
    const blob = new Blob([resultsTable.outerHTML], { type })
    const data = [new ClipboardItem({ [type]: blob })]
    navigator.clipboard.write(data)
  } finally {
    compareProductsButton.classList.remove('loading')
  }
})

const selectAllButton = document.querySelector('#select_all')
selectAllButton.addEventListener('click', () => {
  document
    .querySelectorAll('.include')
    .forEach((checkbox) => (checkbox.checked = true))
  tabsToInclude.add(...validTabs.map((tab) => tab.id))
})

const selectNoneButton = document.querySelector('#select_none')
selectNoneButton.addEventListener('click', () => {
  document
    .querySelectorAll('.include')
    .forEach((checkbox) => (checkbox.checked = false))
  tabsToInclude.clear()
})
