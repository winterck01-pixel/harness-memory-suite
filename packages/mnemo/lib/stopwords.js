


export const EN_STOPWORDS = new Set([

  'a', 'about', 'above', 'across', 'after', 'afterwards', 'again', 'against', 'all', 'almost',
  'alone', 'along', 'already', 'also', 'although', 'always', 'am', 'among', 'an', 'and', 'another',
  'any', 'anyone', 'anything', 'anyway', 'anywhere', 'are', 'aren', 'around', 'as', 'at', 'back',
  'be', 'became', 'because', 'become', 'becomes', 'been', 'before', 'beforehand', 'behind', 'being',
  'below', 'beside', 'besides', 'between', 'beyond', 'both', 'but', 'by', 'can', 'cannot', 'could',
  'did', 'do', 'does', 'doing', 'done', 'down', 'during', 'each', 'either', 'else', 'enough',
  'etc', 'even', 'ever', 'every', 'everyone', 'everything', 'everywhere', 'except', 'far', 'few',
  'for', 'from', 'further', 'get', 'gets', 'getting', 'got', 'had', 'has', 'have', 'having', 'he',
  'hence', 'her', 'here', 'hers', 'herself', 'him', 'himself', 'his', 'how', 'however', 'i', 'if',
  'in', 'indeed', 'instead', 'into', 'is', 'it', 'its', 'itself', 'just', 'keep', 'keeps', 'last',
  'lately', 'later', 'let', 'like', 'likely', 'little', 'many', 'may', 'maybe', 'me', 'meanwhile',
  'merely', 'might', 'mine', 'more', 'moreover', 'most', 'much', 'must', 'my', 'myself', 'near',
  'neither', 'never', 'nevertheless', 'new', 'next', 'no', 'nobody', 'none', 'nor', 'not', 'nothing',
  'now', 'nowhere', 'of', 'off', 'often', 'on', 'once', 'one', 'only', 'onto', 'or', 'other', 'others',
  'otherwise', 'ought', 'our', 'ours', 'ourselves', 'out', 'over', 'own', 'perhaps', 'please',
  'quite', 'rather', 'really', 'regarding', 'same', 'say', 'says', 'seem', 'seems', 'shall', 'she',
  'should', 'simply', 'since', 'so', 'some', 'somebody', 'someone', 'something', 'sometimes',
  'somewhat', 'somewhere', 'soon', 'still', 'such', 'than', 'that', 'the', 'their', 'theirs', 'them',
  'themselves', 'then', 'there', 'thereby', 'therefore', 'these', 'they', 'this', 'those', 'though',
  'thus', 'till',   'to', 'too', 'toward', 'towards', 'under', 'unless', 'until', 'up', 'upon', 'us',
  'use', 'used', 'uses', 'using', 'very', 'via', 'was', 'we', 'well', 'were', 'what', 'whatever', 'when',
  'whenever', 'where', 'whereas', 'wherever', 'whether', 'which', 'whichever', 'while', 'who',
  'whoever', 'whom', 'whose', 'why', 'will', 'with', 'within', 'without', 'would', 'yet', 'you',
  'your', 'yours', 'yourself', 'yourselves',

  'arent', 'cant', 'couldnt', 'didnt', 'doesnt', 'dont', 'hadnt', 'hasnt', 'havent', 'hes', 'ill',
  'im', 'isnt', 'ive', 'lets', 'mightnt', 'mustnt', 'shant', 'shes', 'shouldnt', 'thats',
  'theres', 'theyd', 'theyll', 'theyre', 'theyve', 'wasnt', 'werent', 'whats', 'wheres', 'whos',
  'wont', 'wouldnt', 'youre', 'youve', 'youd', 'youll',

  'ah', 'aha', 'alright', 'anyways', 'eh', 'er', 'erm', 'ha', 'haha', 'hey', 'hi', 'hm', 'hmm',
  'hmmm', 'huh', 'mmm', 'nah', 'nope', 'oh', 'ok', 'okay', 'oops', 'right', 'uh', 'um', 'well',
  'wow', 'yeah', 'yep', 'yes', 'yup',

  'add', 'adds', 'answer', 'ask', 'asks', 'asked', 'bit', 'call', 'called', 'calls', 'check',
  'checks', 'come', 'comes', 'give', 'gives', 'go', 'goes', 'going', 'know', 'knows', 'knew',
  'look', 'looks', 'looking', 'lot', 'lots', 'make', 'makes', 'making', 'made', 'need', 'needs',
  'needed', 'put', 'puts', 'see', 'sees', 'seen', 'sort', 'stuff', 'take', 'takes', 'tell', 'tells',
  'told', 'thing', 'things', 'think', 'thinks', 'thought', 'try', 'tries', 'trying', 'want', 'wants',
  'wanted', 'way', 'ways', 'work', 'works', 'worked',
])


export const ZH_STOPWORDS = new Set([
  '的', '了', '是', '我', '你', '他', '她', '它', '我们', '你们', '他们', '咱们', '自己',
  '这', '那', '这个', '那个', '这些', '那些', '这样', '那样', '这里', '那里',
  '什么', '怎么', '为什么', '哪', '哪里', '哪个', '谁', '如何', '是否', '多少',
  '时候', '现在', '已经', '刚才', '一会', '一下', '一些', '一点', '有点', '之类', '等等',
  '可以', '需要', '应该', '必须', '可能', '也许', '大概', '或许', '一定', '肯定',
  '但是', '但', '不过', '然而', '因为', '所以', '于是', '因此', '然后', '接着', '而且',
  '并且', '或者', '如果', '就是', '还是', '以及', '只要', '只有', '其实', '总之',
  '也', '都', '很', '太', '更', '最', '不', '没', '没有', '别', '再', '又', '才', '就',
  '只', '让', '把', '被', '给', '对', '从', '向', '往', '在', '和', '与', '及', '跟',
  '关于', '对于', '由于', '通过', '根据', '按照', '为了', '一样', '起来', '出来', '下去',
  '好的', '嗯', '哦', '啊', '呀', '吧', '呢', '吗', '嘛', '唉', '哈哈', '嘿', '喂',


  '继续', '收到', '明白', '谢谢', '辛苦', '是的', '对的', '没错', '行吧', '好吧', '可以',


  '看看', '看下', '看一下', '看看', '帮忙', '帮我', '记一下', '记住', '记下', '记得',
  '说', '说下', '说一下', '回答', '回答一下', '回一下', '讲', '讲一下', '查', '查一下',
  '定过', '定一下', '定了', '定', '弄', '弄一下', '搞', '搞一下', '来', '去', '做', '做一下',
  '东西', '事情', '这个', '那个', '这些', '那些', '这样', '那样', '一项', '一条', '一个',
  '一种', '一样', '一点', '一些', '什么', '怎么', '为什么', '哪', '哪里', '哪个', '谁', '如何',


  '写', '写个', '写一下', '有', '没有', '有没有', '个', '几', '每', '各', '另', '还', '能', '会',
  '要', '想', '觉得', '认为', '知道', '感觉', '发现', '看', '见', '听', '用', '拿', '带', '放', '设',
])


const PUNCT_ONLY = /^[\s\p{P}\p{S}]+$/u


const MAX_TOKEN_LEN = 40


const REPEATED_CHAR = /^(.)\1+$/


export function isNoiseWord(w) {
  if (!w) return true
  const s = String(w)
  if (s.length < 2) return true
  if (s.length > MAX_TOKEN_LEN) return true
  if (PUNCT_ONLY.test(s)) return true
  if (REPEATED_CHAR.test(s)) return true
  const lower = s.toLowerCase()
  if (EN_STOPWORDS.has(lower)) return true
  if (ZH_STOPWORDS.has(s)) return true

  if (/^\d+$/.test(s)) return true
  return false
}


export function isStopword(w) {
  if (!w) return true
  const s = String(w)
  return EN_STOPWORDS.has(s.toLowerCase()) || ZH_STOPWORDS.has(s)
}


export function isInformativeCue(c) {
  if (!c) return false
  return !isNoiseWord(c)
}


export function extractZhWords(text) {
  if (!text) return []
  const s = String(text)
  const out = new Set()

  const runs = s.match(/[\u4e00-\u9fff]+/g) ?? []
  for (const run of runs) {


    const parts = splitZh(run)
    for (const p of parts) {

      if (isStopword(p)) continue
      if (p.length < 2) continue
      if (/^\d+$/.test(p)) continue
      if (isNoiseWord(p)) continue
      out.add(p)
    }
  }
  return [...out]
}


function splitZh(run) {

  const zhStops = [...ZH_STOPWORDS].sort((a, b) => b.length - a.length)
  const hard = []
  let cur = ''
  let i = 0
  while (i < run.length) {

    if (/[，。！？；：、（）【】「」『』""''…—·,\.\!\?;:()\[\]]/.test(run[i])) {
      if (cur) { hard.push(cur); cur = '' }
      i++
      continue
    }

    let matched = null
    for (const st of zhStops) {
      if (run.startsWith(st, i)) { matched = st; break }
    }
    if (matched) {
      if (cur) { hard.push(cur); cur = '' }
      i += matched.length
      continue
    }
    cur += run[i]
    i++
  }
  if (cur) hard.push(cur)


  const out = new Set()
  for (const seg of hard) out.add(seg)
  return [...out].filter((w) => w.length >= 2)
}
