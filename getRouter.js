const fs = require('fs')
const express = require('express')
const passport = require('passport')
const md5 = require('crypto-js/md5')
const swaggerUi = require('swagger-ui-express')
const METHOD_DELETE = 'delete'
const METHOD_GET = 'get'
const METHOD_POST = 'post'
const METHOD_PUT = 'put'

const swagger = {
    "swagger": "2.0",
    "info": {
        "title": "",
        "version": "",
        "description": ""
    },
    "host": "petstore.swagger.io",
    "basePath": "/api",
    "tags": [],
    "schemes": ["https", "http"],
    "paths": {},
    "securityDefinitions": {
        "user_auth": {
        "type": "oauth2",
        "tokenUrl": "/v1/auth/login",
        "flow": "password"
        }
    },
    "definitions": {}
}

const getRoute = async (rootPath, config={}) => {
    const isExist = await fs.existsSync(rootPath)
    if(!isExist) throw Error(`There is no directory:: ${rootPath}`)

    const router = express.Router();
    router.use(function (req, res, next) {
        res.header('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, HEAD, OPTIONS');
        res.header('Access-Control-Allow-Origin', '*');
        next();
    });
  
    router.all('/*', function (req, res, next) {
        res.header('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, HEAD, OPTIONS');
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Headers', 'X-Requested-With');
        next();
    });
  
    // Load Controllers
    const pages = [];
    const definitions = {};
    const loadFiles = [];
    const loadPath = async (path, subPath) => {
        const files = await fs.readdirSync(path + subPath, { withFileTypes: true });
        for (const file of files) {
            if (file.isDirectory())
                await loadPath(path, subPath + '/' + file.name);
            else if (file.name.match(/\.js$/) !== null) {
                const exec = require(rootPath + subPath + '/' + file.name);
                loadFiles.push({
                    subPath,
                    file,
                    exec: exec,
                    size: Object.keys(exec.params ? exec.params.path : {}).length || 0,
                });
            }
        }
    };

    await loadPath( rootPath, '');
    loadFiles.sort((a, b) => (a.size > b.size ? 1 : a.size < b.size ? -1 : 0));
  
    for (const obj of loadFiles) {
        const { exec, subPath, file } = obj;
    
        let pageName = '/' + file.name.substring(0, file.name.length - 3);
        if (pageName === '/index') pageName = '';
    
        const parameters = [];
        const responses = {}
    
        const path =      (exec.request ? exec.request.path : undefined) || subPath + pageName 
        const method =    (exec.request ? exec.request.method : undefined) || 'get'
        const params =    exec.params || {};
        const response =  exec.response || null;
    
        let consumes = ['application/json'];

        /*
         *  * Swagger setting * *
        **/
        Object.keys(params.path || {}).forEach((key) => {
            parameters.push({
                name: key,
                in: 'path',
                required: true,
                ...params.path[key],
            });
        });
  
        Object.keys(params.query || {}).forEach((key) => {
            parameters.push({
                name: key,
                in: 'query',
                ...params.path[key],
                ...params.query[key],
            });
        });
        if (Object.keys(params.form || {}).length > 0) {
            consumes = ['multipart/form-data'];
            Object.keys(params.form || {}).forEach((key) => {
                parameters.push({
                    name: key,
                    in: 'formData',
                    ...params.form[key],
                });
            });
        } else if (Array.isArray(params.body) && params.body.length > 0) {
            const key = md5(JSON.stringify(params.body)).toString();
            definitions[key] = {
                type: 'array',
                items: {
                    type: 'object',
                    properties: params.body[0],
                },
            };
            parameters.push({
                name: 'body',
                in: 'body',
                schema: { $ref: '#/definitions/' + key, },
            });
        } else if (Object.keys(params.body || {}).length > 0) {
            const key = md5(JSON.stringify(params.body)).toString();
            definitions[key] = {
                type: 'object',
                properties: params.body,
            };
            parameters.push({
                name: 'body',
                in: 'body',
                schema: { $ref: '#/definitions/' + key, },
            });
        }
        if(response && Object.keys(response).length > 0){
            Object.keys(response).forEach((value)=>{
                if(!response[value].body){
                    responses[value] = response[value]
                    return;
                }
                const key = md5(JSON.stringify(response[value].body)).toString()
                definitions[key] = {
                    type: 'object',
                    properties: response[value].body
                }
                responses[value] = {
                    type: response[value].type || 'object',
                    name: value,
                    description: response[value].description,
                    in: value,
                    schema: { $ref: '#/definitions/' + key },
                }
            })
        }
  
        let security = [];
        if (exec.security && exec.security.length > 0) {
            exec.security = exec.security.map( v => v && v.toLowerCase ? v.toLowerCase() : '');
            security = [ { user_auth: exec.security.map( v => typeof v !== 'string' ? v.toLowerCase() : '' ) } ]
        }
  
        pages.push({
            path,
            method,
            data: {
                tags:           exec.tags,
                summary:        exec.summary,
                security:       security,
                description:    exec.description || '',
                operationId:    method + ':' + path,
                consumes,
                parameters,
            },
            response: responses
        });
  
        /*
         *  * Routing * *
        **/
        const route_uri = path.replace(/\{([a-zA-Z0-9\_]+)\}/g, ':$1');
        router[method](
            route_uri,
            // First Routing:: passport
            (req, res, next) => {
                req.user = undefined;
                passport.authenticate('jwt', { session: false }, async (err, user) => {
                    req.user = undefined;
                    if (!err) req.user = user || undefined
                    next();
                })(req, res, next);
            },
            // Second Routing:: main
            async (req, res, next) => {
                // 404 Not Fount
                if ( !exec || !exec.execute) return next()

                const args = {
                    params: {
                        ...req.params,
                        ...req.body,
                        ...req.query,
                    },
                    files:  req.files,
                    body:   req.body,
                    query:  req.query,
                    path:   req.params,
                };
                try {

                    const RoleMap = config.role_map || { }
                    const user = req.user || { role_byte:0 }
                    const params = args.params;

                    // Get User Roles From Mask
                    const user_roles = Object.keys(RoleMap).reduce( (prev, role)=>
                        user.role_byte & ParseInt(RoleMap[role],2) ? [...prev, role] : prev
                    , req.user ?  ['user'] : [])
                    if(req.user) req.user.roles = user_roles

                    // Permission Check
                    let hasPermission = false
                    if(!exec.security || !exec.security.length || exec.security.includes('any'))
                        hasPermission = true
                    hasPermission = exec.reduce( (prev, sec) => prev || user_roles.includes(sec), hasPermission)

                    // Case 1: User doesn't have permission
                    if(!hasPermission)
                        throw { status: 401, message:'Required Permissions..', data:exec.security }
                    // Case 2: Raw execute function
                    else if (exec.execute.length >= 3)
                        return await exec.execute(req, res, next, { params })
                    // Case 3: Normal execute function
                    const output = await exec.execute({...args, user: req.user});
                    res.status(200).json(output);                    
                } catch (e) {
                    // Non error
                    if(!e) return res.status(500).json({uri:route_uri, data:JSON.stringify(e) })

                    switch(e.status){
                        // * * Unidentified Error * *
                        case null:
                        case undefined:
                        case 0:
                            return res.status(500)
                                .json({ uri: route_uri, message: e.message, data: e.data || JSON.stringify(e) })

                        // * * Redirection * *
                        case 301:
                            return res.redirect(301, e.location);
                        
                        // * * Identified Error * *
                        default:
                            return res.status(e.status)
                                .json({ message: e.message, data: e.data})

                    }
                }
            },
        );
    }
    // Third Routing:: Not Found
    router.use((req, res) => {
        let url = req.protocol + '://' + req.get('host') + req.originalUrl;
        res.type('text/plain');
        res.status(404);
        res.send('404 - Not Found');
    });
    return { router, pages, definitions };
}


const swaggerHandler = ({ pages, definitions, config }) => {
    swagger.definitions = definitions;
    pages.sort((a, b) => {
        const ix1 = a.path//a?.data?.tags?.length ? a.data.tags[0] : a.path
        const ix2 = b.path//b?.data?.tags?.length ? b.data.tags[0] : b.path
        return ix1 > ix2 ? 1 : ix1 < ix2 ? -1 : a.path > b.path ? 1 : a.path < b.path ? -1 : 0;
    });
    pages.forEach((v) => {
        if (!v.data) return
        if (!v.data.tags || !v.data.summary) return;
        if (!swagger.paths[v.path]) swagger.paths[v.path] = {};
        const responses = Object.keys(v.response).length > 0 ?
            v.response : {
                '200': { description: 'Success'},
                '400': { description: 'Parameter Error' },
                '401': { description: 'Authorized Error' },
                '404': { description: 'Not found data' },
            }
        swagger.paths[v.path][v.method] = {
            ...v.data,
            tags: v.data.tags || [],
            responses
        };
    });

    return [
        [
            '/doc.html',
            swaggerUi.serve,
            swaggerUi.setup(null, {
                swaggerOptions: {
                    url: `${config.scheme}://${config.host}/api-docs`,
                },
            }),
        ],
        [
            '/api-docs',
            (req, res) => {
                swagger.host = config.host || req.headers.host;
                swagger.schemes = [config.scheme];
                return res.status(200).json(swagger);
            },
        ],
  ];
};

const register = async(rootPath, config={})=>{
    const {router:mainRouter, pages, definitions} = await getRoute(rootPath, config)
    const swaggerRouter = express.Router()
    const swagger = swaggerHandler( { pages, definitions, config })
    swagger.forEach( v => swaggerRouter.use(...v) )
    return { mainRouter, swaggerRouter}
}


module.exports = {
    Router: register,
    METHOD_DELETE,
    METHOD_GET,
    METHOD_POST,
    METHOD_PUT
}