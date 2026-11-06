// Only cookie-derived authentication needs browser-origin binding. Explicit
// bearer credentials remain available to trusted API clients.
export function adminSessionMiddleware(req:any,res:any,next:()=>void){
 if(!req.headers.authorization){
  const match=(req.headers.cookie||'').match(/(?:^|;\s*)30nice_admin=([^;]+)/);
  if(match){
   try{
    if(process.env.NODE_ENV==='production'&&req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)return res.status(403).json({message:'Yêu cầu phiên quản trị phải cùng nguồn.'});
    req.headers.authorization='Bearer '+decodeURIComponent(match[1]);
   }catch{return res.status(401).json({message:'Phiên quản trị không hợp lệ.'});}
  }
 }
 next();
}
