const express = require('express')
const {Server} = require('socket.io')
const http = require('http')
const getUserDetailsFromToken = require('../helpers/getUserDetailsFromToken')
const { set } = require('mongoose')
const UserModel = require('../models/UserModel')
const { ConversationModel,MessageModel } = require('../models/ConversationModel');
const { log } = require('console')
const getConversation = require('../helpers/getConversation')


const app = express()

// socket connection
const server = http.createServer(app)

const io = new Server(server,{
    cors:{
        origin: process.env.Frontend_url,
        credentials:true
    }
})

const onlineUser = new Set()
io.on('connection',async(socket)=>{
    console.log("connect user ",socket.id)

    const token =   socket.handshake.auth.token

    // current user detail
   const user = await getUserDetailsFromToken(token)
    
    //    create a room
   socket.join(user?._id.toString())
   onlineUser.add(user?._id?.toString())

   io.emit('onlineUser',Array.from(onlineUser))

   socket.on('message-page',async(userId)=>{
    console.log('userId : ',userId)
    
    const userDetails = await UserModel.findById(userId).select("-password")

    const payload= {
        _id:userDetails?._id,
        name:userDetails?.name,
        email:userDetails?.email,
        profile_pic:userDetails?.profile_pic,
        online:onlineUser.has(userId),
    }
    socket.emit('message-user',payload)

      //get previous message
      const getConversationMessage = await ConversationModel.findOne({
        "$or" : [
            { sender : user?._id, receiver : userId },
            { sender : userId, receiver :  user?._id}
        ]
    }).populate('message').sort({ updatedAt : -1 })

    socket.emit('message',getConversationMessage?.message || [])
   })

   
//    new message
   socket.on('new message',async(data)=>{

    // check conversation
    let conversation = await ConversationModel.findOne({
        "$or" : [
            {sender : data?.sender , receiver : data?.receiver},
            {sender : data?.receiver , receiver : data?.sender}
        ]
    })
       
    // if conversation is not available 
    if(!conversation) {
      const createConversation = await ConversationModel({
        sender : data?.sender,
        receiver : data?.receiver
      })
      conversation = await createConversation.save();
    }

    const message = new MessageModel({
        
          text : data.text,
          imageUrl : data.imageUrl,
          videoUrl : data.videoUrl,
          msgByUserId : data?.msgByUserId

    })

    const saveMessage = await message.save()

    const updateConversation = await ConversationModel.updateOne({_id : conversation?._id},{
        "$push": {message: saveMessage._id}
    })

    const getConversationMessage = await ConversationModel.findOne({
        "$or" : [
            {sender : data?.sender , receiver : data?.receiver},
            {sender : data?.receiver , receiver : data?.sender}
        ]
    }).populate('message').sort({ updatedAt: -1});    //sort message in decreasing order
  
    io.to(data?.sender).emit('message',getConversationMessage?.message || [])
    io.to(data?.receiver).emit('message',getConversationMessage?.message || [])
    // console.log("conversation  : ",conversation)
    // console.log("new message  : ",data)
       
    // send conversation
    const conversationSender = await getConversation(data?.sender)
    const conversationReceiver = await getConversation(data?.receiver)
    
    io.to(data?.sender).emit('conversation',conversationSender)
    io.to(data?.receiver).emit('conversation',conversationReceiver)
   })

    //  sidebar
    socket.on('sidebar',async(currentUserId)=>{
        console.log("current user id ",currentUserId)
        const conversation = await getConversation(currentUserId)
        socket.emit("conversation",conversation)   
     
    })
    // disconnect 
    socket.on('disconnect',()=>{
        onlineUser.delete(user?._id)
        console.log("disconnect user",socket.id)

    })
})

module.exports={
    app,
    server
}