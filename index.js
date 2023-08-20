
global.cwd = process.cwd();
global.wait = ms=>new Promise(resolve=>setTimeout(resolve, ms || 1000))
global.fs = require('fs');

let express = require('express');
let WS = require('ws');
let utils = require('./utils.js');


let log = console.log;
let app = express();
let ratio_dimensions = {
    '1:1': '512×512',
    '3:4': '512×680',
    '2:3': '512×768',
    '9:16': '512×912',
    '4:3': '680×512',
    '3:2': '768×512',
    '16:9': '912×512',
};
let task_info = {};
let path_tensor_accounts = cwd+'/tensor_accounts';

fs.mkdirSync(path_tensor_accounts, {
    recursive: true,
});

app.set('json spaces', 4);
app.get('/generated', async(req, res, next)=> {
    let start = Date.now();
    let headers = {
        'accept-language': "vi-VN,vi;q=0.9,fr-FR;q=0.8,fr;q=0.7,en-US;q=0.6,en;q=0.5",
        "content-type": 'application/json',
    };
    let account = random_account(); //await new Promise(resolve=>(check = async()=>(a = random_account(), a = await update_credits_and_reauth_if_err(a), a.credits > 0?resolve(a): (await wait(1000), check())), check()));

    headers.cookie = account.set_cookies.join(', ');

    let ws = new WS('wss://api.tensor.art/pcg-tensor/ws', {
        headers,
    });
    let ping = ()=>ws.send('{"namespace":"ping"}');


    ws.on('open', ()=>(ping(), setInterval(ping, 1000*5), generated(req.query).then(data=>(res.set('exec_time', Date.now()-start), res.send(data.items.map($=>$.url)), update_credits_and_reauth_if_err(account), ws.close())).catch(err=>(log(err),res.status(500).send(`Đã xảy ra lỗi !`)))));
    ws.on('message', Buffer=> {
        let data = JSON.parse(Buffer);

        if (data.namespace == 'pcg.s2c.tensor.works' && data.messageName == 'works.NotifyGenerateTaskInfo') {
            let msg = JSON.parse(data.messageContent);
            let task_id = msg.task.taskId;

            task_info[task_id] = msg.task;
            //msg.task.items.map(($,i)=>log(`task.id <${task_id}> - img ${i+1}: ${$.processPercent}%`));
            log(`task_id <${task_id}>: ${msg.task.items[0].processPercent}%`)
        };
    });


    async function generated(params = {}) {
        if (!params.prompt)delete params.prompt;

        let payload = {
            params,
            taskType: 'TXT2IMG',
        };
        let base_params = require('./params.js').list;

        utils.notInObj_add(payload.params, Object.entries(base_params[params.style_i-1]?.params || base_params[0].params));
        payload.credits = payload.params.imageCount;
        delete payload.params.style_i;
        
        if (payload.params.enableHr) {
            payload.credits = payload.params.imageCount*2;
            if (payload.params.hrResizeX == null)payload.params.hrResizeX = payload.params.width*payload.params.hrResizeRate;
            if (payload.params.hrResizeY == null)payload.params.hrResizeY = payload.params.height*payload.params.hrResizeRate;
        };
        
        let a = payload.params.prompt;
        let ratio = a.match(/1:1|3:4|2:3|9:16|4:3|3:2|16:9/)?.[0];
        a = (a.replace(ratio, ''));
        payload.params.prompt = a;
        let trans_prompt = await(utils.trans(a, 'en'));
        let dms = (ratio_dimensions[ratio] || '').split('×').filter($=>!!$).map($=>+$).filter(isFinite);

        if (dms[0])payload.params.width = dms[0];
        if (dms[1])payload.params.height = dms[1];

        if (trans_prompt[2] != 'en')payload.params.prompt = trans_prompt[0];

        return new Promise((resolve, reject)=>fetch('https://api.tensor.art/works/v1/works/task', {
            method: 'post',
            headers,
            body: JSON.stringify(payload),
        }).then(r=>r.json()).then(json=> {
            let id = json?.data?.task?.taskId; if (!id)throw json;
            let progress = async()=> {
                let task = task_info[id];

                await wait(1000);
                if (!!task && task.items.every($=>$.status == 'FINISH'))(resolve(task), delete task_info[id]); else progress();
            };

            progress();
        }).catch(reject));
    };
},);
app.get('/list-style', (req, res)=>res.send(require('./params.js').list.map($=>$.img_preview)));
app.get('/new-account__', (req, res)=>new_account().then(account=>res.send(account)));
app.get('/list-account__', (req, res)=>res.send(accounts_list()));
app.get('/detail__', (req, res)=> {
    detail_model(req.query.model_id).then(json=>res.send(json.data.model.cover));
});
app.listen(1012);


async function new_account() {
    let address_mail = await utils.mail_tmp.random();
    let token_address = await utils.mail_tmp.token(address_mail);

    log(`Tài khoản mới tại địa chỉ mail: ${address_mail}`);

    return signin_tensor({
        address_mail,
        token_address,
        path: path_tensor_accounts+'/'+Date.now()+'_'+utils.random_string(15),
    });
};
async function update_credits_and_reauth_if_err(account) {
    let get_user = account=>fetch('https://api.tensor.art/user-web/v1/user/credits', {
        headers: {
            cookie: account.set_cookies.join(', '),
        },
    }).then(r=>r.json());
    let user = await get_user(account);

    if (user.code == -1)(log('cookie die, tiến hành đăng nhập lại tại địa chỉ mail: '+account.address_mail), account = await signin_tensor(account), user = await get_user(account)); // đăng nhập lại tài khoản nếu cookie die;

    account.credits = user.data?.dailyAmount;
    fs.writeFileSync(account.path, JSON.stringify(account, 0, 4));

    return account;
};
function random_account() {
    let tensor_accounts = accounts_list().filter($=>isNaN($.credits) || $.credits > 0);
    let account;

    for (let i = 0; i < 100; i++)account = tensor_accounts[Math.random()*tensor_accounts.length<<0];

    return account;
};
function accounts_list() {
    return fs.readdirSync(path_tensor_accounts).map($=>(path = path_tensor_accounts+'/'+$, {
        path,
        ...JSON.parse(fs.readFileSync(path)),
    }));
};
async function signin_tensor( {
    address_mail,
    token_address,
    path,
}) {
    let headers = {
        'accept-language': "vi-VN,vi;q=0.9,fr-FR;q=0.8,fr;q=0.7,en-US;q=0.6,en;q=0.5",
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
        'content-type': 'application/json',
        'x-device-id': utils.random_string(21),
    };
    let signin = await fetch('https://api.tensor.art/user-web/v1/signin', {
        method: 'post',
        headers,
        body: JSON.stringify({
            "email": address_mail,
            "type": "EMAIL",
            "returnUrl": "https://tensor.art/",
        }),
    });

    if (signin.status >= 200 && signin.status <= 204) {
        let $id_msg = await new Promise(resolve=>(check = async()=> {
            await wait(1000);

            let msgs = await utils.mail_tmp.msgs(token_address);
            let msg_first = msgs['hydra:member'][0];

            if (/@tensor\.art$/.test(msg_first?.from?.address) && msg_first?.subject == 'Sign in to Tensor.Art')resolve(msg_first['@id']); else check();
        },
            check()));
        let msg = await utils.mail_tmp.msg($id_msg, token_address);
        let url_auth = msg.text.match(/https:\/\/api\.tensor\.art\/user-web\/signin\/auth\/callback\?[^ \n]+/)[0];
        let url = new URL(url_auth);
        let options = {
            method: 'GET',
            hostname: url.hostname,
            path: url.pathname+url.search,
            headers,
        };
        // nó tự chuyển hướng, cay vc..., nên dùng tạm module https
        let set_cookies = await new Promise(resolve=>(require('https').request(options, res=>resolve(res.headers['set-cookie'])).end())); if (!set_cookies) throw 'Error get cookies, address_mail: '+address_mail;
        let credits = await fetch('https://api.tensor.art/user-web/v1/user/credits', {
            headers: {
                cookie: set_cookies.join(', '),
            },
        }).then(res=>res.json()).then(json=>json.data.dailyAmount);
        let account = {
            address_mail,
            set_cookies,
            credits,
        };

        fs.writeFileSync(path, JSON.stringify(account, 0, 4));
        log('Đã lưu thông tin đăng nhập vào file: '+path);
        account.url_auth = url_auth;

        return account;
    } else throw signin;
};
async function detail_model(id) {
    return fetch('https://api.tensor.art/community-web/v1/model/detail?modelId='+id, {
        headers: (await get_headers())[0],
    }).then(res=>res.json());
};
async function get_headers() {
    let headers = {
        'accept-language': "vi-VN,vi;q=0.9,fr-FR;q=0.8,fr;q=0.7,en-US;q=0.6,en;q=0.5",
        "content-type": 'application/json',
    };
    let account = await new Promise(resolve=>(check = async()=>(a = random_account(), a = await update_credits_and_reauth_if_err(a), a.credits > 0?resolve(a): (await wait(1000), check())), check())); headers.cookie = account.set_cookies.join(', ');
    return [
        headers,
        account
    ];
};
