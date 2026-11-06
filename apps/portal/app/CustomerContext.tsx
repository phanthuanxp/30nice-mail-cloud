'use client';
import {createContext,useCallback,useContext,useEffect,useState} from 'react';
const Context=createContext({tenantId:'',selectTenant:(_id:string)=>{}});
export function CustomerProvider({children}:{children:React.ReactNode}){
 const [tenantId,setTenantId]=useState('');
 useEffect(()=>{try{setTenantId(sessionStorage.getItem('30nice_current_customer')||'');}catch{}},[]);
 const selectTenant=useCallback((id:string)=>{setTenantId(id);try{sessionStorage.setItem('30nice_current_customer',id);}catch{}},[]);
 return <Context.Provider value={{tenantId,selectTenant}}>{children}</Context.Provider>;
}
export const useCustomer=()=>useContext(Context);
