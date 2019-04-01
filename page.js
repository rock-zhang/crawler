const fs = require('fs');
const URL = require('url');
const { map } = require('lodash');
const { URLSearchParams } = URL;
const genericPool = require("generic-pool");
const {
    redisClient,
    logger,
    getRandomIP,
    htmlFetch
} = require('./util');
const { videoPageBase, listPageBase } = require('./config.json');
const puppeteer = require('puppeteer');

let page = 1;
function getPageCount () {
    return page++;
}

const factory = {
    create: function () {
        console.log('create page...')
        return 'client...';
    },
    destroy: function (listPageUrl) {
        console.log('destroy listPageUrl...', listPageUrl)
        console.log('destroy', listPageUrl);
    }
};

const pagePool = genericPool.createPool(factory, {
    max: 10, // maximum size of the pool
    min: 5 // minimum size of the pool
});

const pageCount = 7, videoInfoList = [];
let i = 1;

(async function () {
    const browser = await puppeteer.launch({
        // headless: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    })
    const puppeteerpool = genericPool.createPool({
        create: function () {
            console.log('create puppeteer...')
            return browser.newPage();
        },
        destroy: function (page) {
            console.log('destroy puppeteer...');
            page.close()
        }
    }, {
            max: 10, // maximum size of the pool
            min: 1 // minimum size of the pool
        });


    while (i <= pageCount) {
        const pageClient = await pagePool.acquire()
        const listPageUrl = `${listPageBase}?category=rf&page=${getPageCount()}`;
        const $ = await htmlFetch(listPageUrl)
        const viewkeyList = []

        $('#videobox .listchannel').each(async function (i, elem) {
            const url = $(this).find('a').attr('href')
            const viewkey = new URLSearchParams(URL.parse(url).query).get('viewkey')
            viewkeyList.push(viewkey)
        })

        console.log('viewkeyList:', viewkeyList)
        Promise.all(map(viewkeyList, async viewkey => {
            const videoInfo = await redisClient.hgetallAsync(viewkey)

            if (!videoInfo) {
                let videoInfo;
                const puppClient = await puppeteerpool.acquire()
                try {
                    videoInfo = await getVideoInfo(videoPageUrlParse(viewkey), puppClient, viewkey)
                    videoInfo && await redisClient.hmset(viewkey, videoInfo)
                } catch (e) {
                    console.error('getVideoInfo catch:', e)
                } finally {
                    puppeteerpool.release(puppClient)
                }
            } else {
                console.log(`key exsit ${viewkey}`)
            }
        }))

        pagePool.release(pageClient)
        i++
    }
})()

async function getVideoInfo (url, puppClient, viewkey) {
    console.log('getVideoInfo:', url)
    let videoInfo
    try {
        await puppClient.setExtraHTTPHeaders({
            'X-Forwarded-For': getRandomIP(),
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,es;q=0.7,zh-TW;q=0.6,fi;q=0.5,ko;q=0.4'
        })
        await puppClient.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/72.0.3626.121 Safari/537.36')
        await puppClient.goto(url, {
            timeout: 120000,
            waitUntil: ['networkidle2', 'domcontentloaded']
        });

        console.log('goto done...', url)
        // const content = await puppClient.content()
        // console.log('content:', content)

        await puppClient.waitForSelector('video', { timeout: 60000 })
        videoInfo = await puppClient.evaluate(() => {
            if (!document.querySelectorAll('#container_video').length) throw Error(`视频不存在，${url}`)

            return {
                url: document.querySelectorAll('video')[0].currentSrc,
                name: document.querySelector('#viewvideo-title').textContent.trim(),
                duration: document.querySelector('.boxPart').textContent.trim().slice(4, 9),
                date: document.querySelectorAll('#videodetails-content>.title')[0].textContent,
            }
        })
    } catch (e) {
        logger.error('getVideoInfo: ', url, videoInfo, e);
        return Promise.reject(new Error('getVideoInfo: puppeteer error'));
    }

    console.log('videoInfo:', videoInfo, url)
    return {
        url: videoInfo.url,
        name: `${videoInfo.name}.mp4`,
        duration: videoInfo.duration,
        date: videoInfo.date,
    }
}

function videoPageUrlParse (viewkey) {
    return `${videoPageBase}?${new URLSearchParams({ viewkey }).toString()}`;
}