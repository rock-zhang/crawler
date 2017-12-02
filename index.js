const cheerio = require('cheerio')
const request = require('request');
const URL = require('url');
const { URLSearchParams } = URL;

const listPageUrl = 'http://91porn.com/video.php?category=rf&page=1',
    videoPageBase = 'http://91porn.com/view_video.php';


htmlFetch(listPageUrl).then($ => {
    $('#videobox .listchannel').each(async function (i, elem) {
        const url = $(this).find('a').attr('href'),
            viewkey = new URLSearchParams(URL.parse(url).query).get('viewkey');
        console.log(`viewkey ${i}: `, viewkey, videoPageUrlParse(viewkey));

        const videoID = await getVideoId(videoPageUrlParse(viewkey));
        console.log('videoID:', videoID, getVideoURL(videoID));
    });
});

function htmlFetch(url) {
    return new Promise(resolve => {
        request(url, function (error, response, body) {
            if (error)
                console.error('request error:', error);

            console.log(`${url} response:`, response.statusCode);
            resolve(cheerio.load(body));
        });
    });
}

function getVideoId(url) {
    return htmlFetch(url).then($ => {
        const reg = /(?<=fxFeatureVideo\(0\, )\d+(?=\)\;)/;

        return reg.exec($.html())[0];
    })
}

function getVideoURL(id) {
    return `http://g.t4k.space//mp43/${id}.mp4`;
}

function videoPageUrlParse(viewkey) {
    return `${videoPageBase}?${new URLSearchParams({ viewkey }).toString()}`;
}



