const fs = require('fs');
const URL = require('url');
const { URLSearchParams } = URL;
const genericPool = require("generic-pool");
const {
    redisClient,
    logger, downloadedLogger,
    getRandomIP,
    htmlFetch
 } = require('./util');
const { videoPageBase, listPageBase } = require('./config.json');

let page = 1;
function getPageCount() {
    return page++;
}

const factory = {
    create: function () {
        return 'client...';
    },
    destroy: function (listPageUrl) {
        console.log('destroy', listPageUrl);
    }
};

const pagePool = genericPool.createPool(factory, {
    max: 10, // maximum size of the pool
    min: 2 // minimum size of the pool
});

const pageCount = 118, videoInfoList = [];
let i = 1;
while (i < pageCount) {
    pagePool.acquire().then(function (client) {
        const listPageUrl = `${listPageBase}?category=rf&page=${getPageCount()}`;

        htmlFetch(listPageUrl).then($ => {
            $('#videobox .listchannel').each(function (i, elem) {
                const url = $(this).find('a').attr('href'),
                    viewkey = new URLSearchParams(URL.parse(url).query).get('viewkey');

                redisClient.hgetallAsync(viewkey).then(async videoInfo => {
                    if (!videoInfo) {
                        let videoInfo;
                        try {
                            videoInfo = await getVideoInfo(videoPageUrlParse(viewkey), viewkey);

                            videoInfo && redisClient.hmset(viewkey, videoInfo);

                            console.log(viewkey, videoInfo);
                        } catch (e) {
                            console.error('getVideoInfo catch:', e);
                        }
                    } else {
                        console.log(`key exsit ${viewkey}`);
                    }
                });
            });

            pagePool.release(client);
        });
    }).catch(function (err) {
        console.log('pagePool resourcePromise catch', err);
    });

    i++;
}

function getVideoInfo(url, viewkey) {
    return htmlFetch(url, true).then($ => {
        let videoUrl = '', duration = '', name = '';
        const nameReg = /(?<=mp43\/)\d+(?=\.mp4?)/,
            urlReg = /(?<=source src=\").+(?=\" type)/,
            durationReg = /(?<=&#x65F6;&#x957F;:\<\/span\> ).+(?=\n&#xA0;\<sp)/,
            html = $.html();

        try {
            const urlDom = urlReg.exec(html);
            videoUrl = urlDom[0];
            videoUrl = videoUrl.replace('amp;', '');

            duration = durationReg.exec(html);
            name = nameReg.exec(videoUrl);
        } catch (e) {
            logger.error('getVideoInfo: 正则表达式匹配出错', url, videoUrl);
            return Promise.reject(new Error('getVideoInfo: 正则表达式匹配出错'));
        }

        return {
            url: videoUrl,
            name: name && name[0] + '_' + viewkey + '.mp4',
            title: $('#viewvideo-title').text().replace(/\n/g, ''),
            duration: duration && duration[0] || '',
            date: $('#videodetails #videodetails-content > .title').eq(0).html() || ''
        }
    });
}

function videoPageUrlParse(viewkey) {
    return `${videoPageBase}?${new URLSearchParams({ viewkey }).toString()}`;
}