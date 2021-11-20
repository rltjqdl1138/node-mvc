const express = require('express')
const cors = require('cors')
const { Router } = require('./getRouter')
const passport = require('passport')

appRun = async()=>{
    const {mainRouter, swaggerRouter} = await Router(__dirname + '/controllers')
    const app = express()
    app.use(cors())

    app.use(express.json({ limit: '500mb' }));
    app.use(express.urlencoded({ limit: '500mb', extended: false }));
    app.use(
        passport.initialize({ passReqToCallback: true }),
    );
    app.use('/api', mainRouter)
    app.use('/swagger', swaggerRouter)
    app.listen(3900)
}

appRun()