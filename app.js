var express = require('express');
var cheerio = require('cheerio');
var url = require('url');
var superagent = require('superagent');
var fs = require("fs");
var async = require('async');
var app = express();


var targetUrl = 'http://weibo.com/p/1005051934160513/follow?relate=fans&from=100505&wvr=6&mod=headfans&current=fans#place';
var baseUrl = 'http://weibo.com'

app.get('/', function(req, res, next) {
    superagent.get(targetUrl)
        .end(function(err, sres) {
            if (err) {
                return next(err);
            }
            var $ = cheerio.load(sres.text);
            var topicUrls = [];
            fs.writeFile('results.txt', sres.text, function(err) {
                if (err) throw err;
                console.log('saved'); //文件被保存
            });
            async.auto({
                getTopicUrls: function(callback) {
                    $('.follow_item a.S_txt1').each(function(idx, element) {
                        var $element = $(element);
                        // var username = $element.text();
                        var href = url.resolve(baseUrl, $element.attr('href'));
                        topicUrls.push(href);
                    });
                    callback(null, topicUrls);
                },
                getScore: ['getTopicUrls', function(callback, results) {
                    console.log(results)
                    var profile = async.mapLimit(results.getTopicUrls, 1, function(item, callback) {
                        superagent.get(item)
                            .end(function(err, sres) {
                                var $ = cheerio.load(sres.text);
                                var username = $('.username').text();
                                var title = $('.pf_intro').text();
                                var sProfile = {
                                    usrname: usrname,
                                    title: title
                                };
                                callback(null, sProfile);
                            });
                    }, function(err, results) {
                        res.send(results);
                        // console.log(results)
                    });

                    callback(null, results);
                }]
            }, function(err, results) {

            });


            // var ep = new eventproxy();

            // ep.after('topic_html', topicUrls.length, function(topics) {

            //     topics = topics.map(function(topicPair) {
            //         var topicUrl = topicPair[0];
            //         var topicHtml = topicPair[1];
            //         var $ = cheerio.load(topicHtml);
            //         return ({
            //             title: $('.topic_full_title').text().trim(),
            //             href: topicUrl,
            //             comment1: $('.reply_item').eq(0).text().trim(),
            //         });
            //     });

            //     console.log('final');
            //     res.send(topics);
            // });

            // topicUrls.forEach(function(topicUrl, idx) {
            //     superagent.get(topicUrl)
            //         .end(function(err, res) {
            //             var tarTxt = "result" + idx + ".json";
            //             fs.writeFile(tarTxt, res.text, function(err) {
            //                 if (err) throw err;
            //                 console.log(idx); //文件被保存
            //             });

            //             ep.emit('topic_html', [topicUrl, res.text]);
            //         });
            // });

            // fs.writeFile("result.txt", items, function(err) {
            //     if (err) throw err;
            //     console.log("File Saved !"); //文件被保存
            // });
        });
});




app.listen(3000, function() {
    console.log('app is listening at port 3000');
});
